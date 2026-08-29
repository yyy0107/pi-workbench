"use client";

import { useId, useMemo, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, XIcon } from "lucide-react";

import { languageForFilename } from "@/components/code-highlighting/shiki-catalog";
import { useWorkbenchHighlightedCode } from "@/components/code-highlighting/use-workbench-highlighted-code";
import { cn } from "@/lib/utils";

import { DiffHeader, type DiffLine } from "./code-diff";
import { codeScroll, codeSurface, mono, paper } from "./surfaces";

export type HunkDecision = "pending" | "kept" | "discarded";

export interface DiffHunk {
  id: string;
  range: string;
  decision: HunkDecision;
  lines: readonly DiffLine[];
}

export interface ReviewableDiffLabels {
  discard: ReactNode;
  discardHunk: (range: string) => string;
  keep: ReactNode;
  keepAll: ReactNode;
  keepHunk: (range: string) => string;
  kept: ReactNode;
  discarded: ReactNode;
  remaining: (count: number) => ReactNode;
  allReviewed: ReactNode;
}

const KEEP_BUTTON_CLASS =
  "flex h-6 items-center gap-1 rounded-full bg-emerald-500/12 px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-[11px] leading-[var(--control-text-line-height)]! font-medium text-emerald-700 transition-[background-color,scale] duration-150 hover:bg-emerald-500/20 active:scale-[0.96] dark:text-emerald-300";

function numberedHunkLines(hunk: DiffHunk) {
  const range = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunk.range);
  let oldLine = Number(range?.[1] ?? 1);
  let newLine = Number(range?.[2] ?? 1);

  return hunk.lines.map((line) => {
    const lineNumber = line.kind === "removed" ? oldLine : newLine;
    if (line.kind !== "added") oldLine += 1;
    if (line.kind !== "removed") newLine += 1;
    return { line, lineNumber };
  });
}

function hunkLineStyles(rootSelector: string, hunk: DiffHunk): string {
  return numberedHunkLines(hunk)
    .map(({ line, lineNumber }, index) => {
      const selector = `${rootSelector} [data-reviewable-diff-code] .line:nth-child(${index + 1})`;
      if (line.kind === "added") {
        return `${selector}{background:var(--reviewable-diff-added-background)}${selector}::before{content:"${lineNumber}";color:var(--reviewable-diff-added)}${selector}::after{content:"+";color:var(--reviewable-diff-added)}`;
      }
      if (line.kind === "removed") {
        return `${selector}{background:var(--reviewable-diff-removed-background)}${selector}::before{content:"${lineNumber}";color:var(--reviewable-diff-removed)}${selector}::after{content:"−";color:var(--reviewable-diff-removed)}`;
      }
      return `${selector}::before{content:"${lineNumber}"}`;
    })
    .join("");
}

function ReviewableDiffHunkCode({ filename, hunk }: { filename: string; hunk: DiffHunk }) {
  const reactId = useId();
  const codeId = `reviewable-diff-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootSelector = `[data-reviewable-diff-code-id="${codeId}"]`;
  const code = useMemo(() => hunk.lines.map((line) => line.text).join("\n"), [hunk.lines]);
  const language = useMemo(() => languageForFilename(filename), [filename]);
  const highlighted = useWorkbenchHighlightedCode(code, language);
  const numberedLines = useMemo(() => numberedHunkLines(hunk), [hunk]);
  const lineStyles = useMemo(() => hunkLineStyles(rootSelector, hunk), [hunk, rootSelector]);

  return (
    <div data-reviewable-diff-code-id={codeId} className="min-w-full font-mono text-xs">
      <style>{`
        ${rootSelector} {
          --reviewable-diff-added: #16a34a;
          --reviewable-diff-added-background: rgb(34 197 94 / 0.11);
          --reviewable-diff-removed: #dc2626;
          --reviewable-diff-removed-background: rgb(239 68 68 / 0.09);
        }
        .dark ${rootSelector} {
          --reviewable-diff-added: #4ade80;
          --reviewable-diff-added-background: rgb(34 197 94 / 0.12);
          --reviewable-diff-removed: #f87171;
          --reviewable-diff-removed-background: rgb(239 68 68 / 0.11);
        }
        ${rootSelector} [data-reviewable-diff-code] > pre {
          width: max-content;
          min-width: 100%;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
          font-family: inherit !important;
          font-size: 12px !important;
          line-height: 24px !important;
          tab-size: 2;
        }
        ${rootSelector} [data-reviewable-diff-code] > pre > code {
          display: block;
          width: max-content;
          min-width: 100%;
          font-size: 0;
          line-height: 0;
        }
        ${rootSelector} [data-reviewable-diff-code] .line {
          position: relative;
          display: block;
          min-height: 24px;
          padding-inline-start: 68px;
          padding-inline-end: 16px;
          font-size: 12px;
          line-height: 24px;
          white-space: pre;
        }
        ${rootSelector} [data-reviewable-diff-code] .line::before {
          position: absolute;
          inset-block: 0;
          inset-inline-start: 0;
          width: 44px;
          padding-inline-end: 8px;
          color: var(--muted-foreground);
          text-align: end;
          font-variant-numeric: tabular-nums;
          user-select: none;
        }
        ${rootSelector} [data-reviewable-diff-code] .line::after {
          position: absolute;
          inset-block: 0;
          inset-inline-start: 48px;
          width: 12px;
          text-align: center;
          user-select: none;
        }
        ${lineStyles}
      `}</style>
      <div data-reviewable-diff-code="" className="min-w-full">
        {highlighted ?? (
          <pre>
            <code>
              {numberedLines.map(({ line }, index) => (
                <span key={`${hunk.id}-${index}`} className="line">
                  {line.text || " "}
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}

export function ReviewableDiff({
  filename,
  hunks,
  labels,
  onKeep,
  onDiscard,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "filename" | "hunks" | "onKeep" | "onDiscard"> & {
  filename: string;
  hunks: readonly DiffHunk[];
  labels: ReviewableDiffLabels;
  onKeep?: (id: string) => void;
  onDiscard?: (id: string) => void;
}) {
  const additions = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "added").length,
    0,
  );
  const deletions = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "removed").length,
    0,
  );
  const pending = hunks.filter((hunk) => hunk.decision === "pending").length;
  const keepAll = () => {
    for (const hunk of hunks) {
      if (hunk.decision === "pending") onKeep?.(hunk.id);
    }
  };

  return (
    <div
      data-slot="reviewable-diff"
      className={cn(paper, "flex w-full max-w-md flex-col overflow-hidden rounded-2xl", className)}
      {...props}
    >
      <DiffHeader filename={filename} additions={additions} deletions={deletions}>
        <div className="ms-3 flex shrink-0 items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {pending > 0 ? labels.remaining(pending) : labels.allReviewed}
          </span>
          {pending > 0 ? (
            <button type="button" onClick={keepAll} className={KEEP_BUTTON_CLASS}>
              <CheckIcon className="size-3" />
              {labels.keepAll}
            </button>
          ) : null}
        </div>
      </DiffHeader>

      <div
        data-slot="reviewable-diff-scroll"
        className="flex h-72 min-h-0 flex-col overflow-y-auto overscroll-contain"
      >
        {hunks.map((hunk, hunkIndex) => {
          return (
            <div
              key={hunk.id}
              data-slot="reviewable-diff-hunk"
              className={cn(
                "transition-opacity duration-300",
                hunkIndex === 0 ? "border-foreground/[0.06] border-t" : "border-muted border-t-4",
                hunk.decision === "discarded" && "opacity-40",
              )}
            >
              <div className="flex items-center justify-end px-4 py-1.5">
                <span className="flex items-center gap-1">
                  {hunk.decision === "pending" ? (
                    <>
                      <button
                        type="button"
                        aria-label={labels.discardHunk(hunk.range)}
                        onClick={() => onDiscard?.(hunk.id)}
                        className="text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/90 flex h-6 items-center gap-1 rounded-full px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-[11px] leading-[var(--control-text-line-height)]! font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
                      >
                        <XIcon className="size-3" />
                        {labels.discard}
                      </button>
                      <button
                        type="button"
                        aria-label={labels.keepHunk(hunk.range)}
                        onClick={() => onKeep?.(hunk.id)}
                        className={KEEP_BUTTON_CLASS}
                      >
                        <CheckIcon className="size-3" />
                        {labels.keep}
                      </button>
                    </>
                  ) : (
                    <span
                      className={cn(
                        mono,
                        "fade-in animate-in duration-300",
                        hunk.decision === "kept"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-foreground/35",
                      )}
                    >
                      {hunk.decision === "kept" ? labels.kept : labels.discarded}
                    </span>
                  )}
                </span>
              </div>
              <div className={cn(codeScroll, "pb-1.5")}>
                <div className={codeSurface}>
                  <ReviewableDiffHunkCode filename={filename} hunk={hunk} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
