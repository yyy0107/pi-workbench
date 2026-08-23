"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react";
import { useRef } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import type { ProgressiveTextDocument, ProgressiveTextSnapshot } from "./progressive-text-document";
import type { ProgressiveTextStage } from "./use-progressive-text-document";

const LINE_HEIGHT = 24;

function progressPercent(snapshot: ProgressiveTextSnapshot): number | undefined {
  if (!snapshot.totalBytes) return undefined;
  return Math.min(100, Math.max(0, Math.round((snapshot.loadedBytes / snapshot.totalBytes) * 100)));
}

export function VirtualizedTextViewer({
  ariaLabel,
  document,
  snapshot,
  stage,
  onRetry,
}: Readonly<{
  ariaLabel: string;
  document: ProgressiveTextDocument;
  snapshot: ProgressiveTextSnapshot;
  stage: ProgressiveTextStage;
  onRetry(): void;
}>) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: snapshot.lineCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 24,
    useFlushSync: false,
    directDomUpdates: true,
  });
  const percent = progressPercent(snapshot);
  const loading = stage === "loading" || stage === "rendering";
  const statusLabel =
    stage === "rendering"
      ? percent === undefined
        ? t("extensions.workspaceFile.renderingLargeText")
        : t("extensions.workspaceFile.renderingLargeTextProgress", { percent })
      : percent === undefined
        ? t("extensions.workspaceFile.loadingLargeText")
        : t("extensions.workspaceFile.loadingLargeTextProgress", { percent });

  if (snapshot.lineCount === 0) {
    return (
      <div
        role={stage === "error" ? "alert" : "status"}
        aria-label={ariaLabel}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <div className="absolute inset-0 space-y-3 p-4 opacity-35" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              className="bg-muted h-3 animate-pulse rounded-full motion-reduce:animate-none"
              style={{ width: `${42 + ((index * 17) % 48)}%` }}
            />
          ))}
        </div>
        <div className="bg-background/88 relative z-10 flex items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
          {stage === "error" ? (
            <>
              <AlertCircleIcon aria-hidden="true" className="size-4 text-red-500" />
              <span>{t("extensions.workspaceFile.largeTextLoadFailed")}</span>
              <button
                type="button"
                className="hover:bg-muted rounded-md px-2 py-1"
                onClick={onRetry}
              >
                {t("extensions.workspaceFile.retryLargeText")}
              </button>
            </>
          ) : (
            <>
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              <span>{statusLabel}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        role="region"
        aria-label={ariaLabel}
        className="size-full overflow-auto overscroll-contain font-mono text-[12px] leading-6 [contain:strict] [scrollbar-gutter:stable]"
      >
        <div
          ref={virtualizer.containerRef}
          role="list"
          className="relative min-w-full animate-in fade-in duration-300 motion-reduce:animate-none"
          style={{
            minWidth: `max(100%, calc(72px + ${Math.min(snapshot.longestLineLength, 20_000)}ch))`,
          }}
        >
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              role="listitem"
              aria-posinset={row.index + 1}
              aria-setsize={snapshot.lineCount}
              className="absolute top-0 left-0 flex h-6 w-max min-w-full"
              style={{ height: LINE_HEIGHT }}
            >
              <span
                aria-hidden="true"
                className="bg-background text-muted-foreground/55 sticky left-0 z-10 w-[60px] shrink-0 pe-3 text-end tabular-nums select-none"
              >
                {row.index + 1}
              </span>
              <code className="block whitespace-pre pe-4 ps-3 [tab-size:2]">
                {document.lineAt(row.index) || " "}
              </code>
            </div>
          ))}
        </div>
      </div>

      <div
        role={stage === "error" ? "alert" : "status"}
        className={cn(
          "bg-background/88 absolute top-3 right-4 z-20 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-sm backdrop-blur-sm transition-[opacity,transform] duration-300 motion-reduce:transition-none",
          stage === "ready" && "translate-y-0 opacity-70",
        )}
        title={t("extensions.workspaceFile.largeTextReadOnly")}
      >
        {stage === "error" ? (
          <>
            <AlertCircleIcon aria-hidden="true" className="size-3.5 text-red-500" />
            <span>{t("extensions.workspaceFile.largeTextLoadFailed")}</span>
            <button
              type="button"
              className="hover:bg-muted rounded-md px-1.5 py-0.5"
              onClick={onRetry}
            >
              {t("extensions.workspaceFile.retryLargeText")}
            </button>
          </>
        ) : loading ? (
          <>
            <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
            <span>{statusLabel}</span>
          </>
        ) : (
          <span>
            {t("extensions.workspaceFile.optimizedLargeText", { lines: snapshot.lineCount })}
          </span>
        )}
      </div>

      <div
        aria-hidden="true"
        className={cn(
          "bg-muted absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden transition-opacity duration-300",
          loading ? "opacity-100" : "opacity-0",
        )}
      >
        <div
          className={cn(
            "h-full bg-blue-500 transition-[width] duration-200 ease-out dark:bg-blue-400",
            percent === undefined && "w-1/3 animate-pulse motion-reduce:animate-none",
          )}
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
