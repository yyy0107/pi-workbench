"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo, useRef, type CSSProperties } from "react";
import type { ThemedToken } from "shiki/core";

import type { WorkbenchShikiLanguage } from "@workbench/shell/code-highlighting";
import { useWorkbenchHighlightedLines } from "@workbench/shell/code-highlighting";
import { Button } from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import { cn } from "@workbench/shell/utils";

import type { ProgressiveTextDocument, ProgressiveTextSnapshot } from "./progressive-text-document";
import type { ProgressiveTextStage } from "./use-progressive-text-document";
import { createVirtualizedCodeWindow } from "./virtualized-code-window";

const LINE_HEIGHT = 24;

function progressPercent(snapshot: ProgressiveTextSnapshot): number | undefined {
  if (!snapshot.totalBytes) return undefined;
  if (snapshot.loadedBytes >= snapshot.totalBytes) return 100;
  return Math.min(99, Math.max(0, Math.floor((snapshot.loadedBytes / snapshot.totalBytes) * 100)));
}

function tokenStyle(token: ThemedToken): CSSProperties | undefined {
  const raw = token.htmlStyle;
  if (!raw) return token.color ? { color: token.color } : undefined;

  const style = {} as CSSProperties & Record<`--${string}`, string>;
  for (const [property, value] of Object.entries(raw)) {
    if (property.startsWith("--")) {
      style[property as `--${string}`] = value;
      continue;
    }
    if (property === "background-color") style.backgroundColor = value;
    else if (property === "font-style") style.fontStyle = value as CSSProperties["fontStyle"];
    else if (property === "font-weight") style.fontWeight = value as CSSProperties["fontWeight"];
    else if (property === "text-decoration") style.textDecoration = value;
    else if (property === "color") style.color = value;
  }
  return style;
}

function VirtualizedCodeLine({
  highlightedLength,
  line,
  tokens,
}: Readonly<{
  highlightedLength: number;
  line: string;
  tokens: readonly ThemedToken[] | undefined;
}>) {
  if (!tokens) return line || " ";

  return (
    <>
      {tokens.map((token, index) => (
        <span key={`${token.offset}:${index}`} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
      {line.slice(highlightedLength)}
    </>
  );
}

export function VirtualizedTextViewer({
  ariaLabel,
  document,
  language,
  snapshot,
  stage,
  onRetry,
}: Readonly<{
  ariaLabel: string;
  document: ProgressiveTextDocument;
  language: WorkbenchShikiLanguage;
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
    directDomUpdatesMode: "position",
  });
  const virtualItems = virtualizer.getVirtualItems();
  const firstVirtualLine = virtualItems[0]?.index;
  const lastVirtualLine = virtualItems.at(-1)?.index;
  const codeWindow = useMemo(
    () =>
      createVirtualizedCodeWindow(document, firstVirtualLine, lastVirtualLine, snapshot.lineCount),
    [document, firstVirtualLine, lastVirtualLine, snapshot.lineCount, snapshot.loadedBytes],
  );
  const highlighted = useWorkbenchHighlightedLines(codeWindow?.code ?? "", language, {
    enabled: stage === "ready" && codeWindow !== undefined,
    grammarContextCode: codeWindow?.contextCode,
  });
  const percent = progressPercent(snapshot);
  const highlighting = stage === "ready" && highlighted.pending;
  const busy = stage === "loading" || stage === "rendering" || highlighting;
  const visiblePercent = highlighting ? undefined : percent;
  const statusLabel = highlighting
    ? t("extensions.workspaceFile.renderingLargeText")
    : stage === "rendering"
      ? visiblePercent === undefined
        ? t("extensions.workspaceFile.renderingLargeText")
        : t("extensions.workspaceFile.renderingLargeTextProgress", { percent: visiblePercent })
      : visiblePercent === undefined
        ? t("extensions.workspaceFile.loadingLargeText")
        : t("extensions.workspaceFile.loadingLargeTextProgress", { percent: visiblePercent });

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
              <Button type="button" variant="ghost" size="xs" className="text-xs" onClick={onRetry}>
                {t("extensions.workspaceFile.retryLargeText")}
              </Button>
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
          {virtualItems.map((row) => {
            const line = document.lineAt(row.index);
            const windowIndex = codeWindow ? row.index - codeWindow.startLine : -1;
            const tokens = windowIndex >= 0 ? highlighted.tokens?.[windowIndex] : undefined;
            const highlightedLength =
              windowIndex >= 0 ? (codeWindow?.highlightedLineLengths[windowIndex] ?? 0) : 0;
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                role="listitem"
                aria-posinset={row.index + 1}
                aria-setsize={snapshot.lineCount}
                className="absolute left-0 flex h-6 w-max min-w-full"
                style={{ height: LINE_HEIGHT }}
              >
                <span
                  aria-hidden="true"
                  className="bg-background text-muted-foreground/55 sticky left-0 z-10 w-[60px] shrink-0 pe-3 text-end tabular-nums select-none"
                >
                  {row.index + 1}
                </span>
                <code className="block whitespace-pre pe-4 ps-3 [tab-size:2]">
                  <VirtualizedCodeLine
                    highlightedLength={highlightedLength}
                    line={line}
                    tokens={tokens}
                  />
                </code>
              </div>
            );
          })}
        </div>
      </div>

      <div
        aria-hidden="true"
        className={cn(
          "bg-muted absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden transition-opacity duration-300",
          busy ? "opacity-100" : "opacity-0",
        )}
      >
        <div
          className={cn(
            "h-full bg-blue-500 transition-[width] duration-200 ease-out dark:bg-blue-400",
            visiblePercent === undefined && "w-1/3 animate-pulse motion-reduce:animate-none",
          )}
          style={visiblePercent === undefined ? undefined : { width: `${visiblePercent}%` }}
        />
      </div>
    </div>
  );
}
