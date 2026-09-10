"use client";

import { useLayoutEffect, useMemo, useRef, type ComponentProps } from "react";

import { languageForFilename } from "../code-highlighting/shiki-catalog";
import { useWorkbenchHighlightedCode } from "../code-highlighting/use-workbench-highlighted-code";
import { cn } from "../utils";

import { DiffHeader, type DiffLine } from "./code-diff";
import { codeScroll, codeSurface, paper } from "../ui/surface";

export type HunkDecision = "pending" | "kept" | "discarded";

export interface DiffHunk {
  id: string;
  range: string;
  decision: HunkDecision;
  lines: readonly DiffLine[];
}

export function numberedHunkLines(hunk: DiffHunk) {
  const range = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunk.range);
  let oldLine = Number(range?.[1] ?? 1);
  let newLine = Number(range?.[2] ?? 1);

  return hunk.lines.map((line) => {
    const lineNumber = line.kind === "removed" ? oldLine : newLine;
    const oldLineNumber = line.kind === "added" ? undefined : oldLine;
    const newLineNumber = line.kind === "removed" ? undefined : newLine;
    if (line.kind !== "added") oldLine += 1;
    if (line.kind !== "removed") newLine += 1;
    return { line, lineNumber, oldLine: oldLineNumber, newLine: newLineNumber };
  });
}

function ReviewableDiffHunkCode({ filename, hunk }: { filename: string; hunk: DiffHunk }) {
  const codeRef = useRef<HTMLDivElement>(null);
  const code = useMemo(() => hunk.lines.map((line) => line.text).join("\n"), [hunk.lines]);
  const language = useMemo(() => languageForFilename(filename), [filename]);
  const highlighted = useWorkbenchHighlightedCode(code, language);
  const numberedLines = useMemo(() => numberedHunkLines(hunk), [hunk]);

  useLayoutEffect(() => {
    const renderedLines = codeRef.current?.querySelectorAll<HTMLElement>(".line");
    renderedLines?.forEach((element, index) => {
      const numberedLine = numberedLines[index];
      if (!numberedLine) {
        delete element.dataset.reviewableDiffKind;
        delete element.dataset.reviewableDiffLineNumber;
        return;
      }
      element.dataset.reviewableDiffKind = numberedLine.line.kind;
      element.dataset.reviewableDiffLineNumber = String(numberedLine.lineNumber);
    });
  }, [highlighted, numberedLines]);

  return (
    <div data-reviewable-diff-code-root="" className="min-w-full font-mono text-xs">
      <div ref={codeRef} data-reviewable-diff-code="" className="min-w-full">
        {highlighted ?? (
          <pre>
            <code>
              {numberedLines.map(({ line, lineNumber }, index) => (
                <span
                  key={`${hunk.id}-${index}`}
                  className="line"
                  data-reviewable-diff-kind={line.kind}
                  data-reviewable-diff-line-number={lineNumber}
                >
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
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "filename" | "hunks"> & {
  filename: string;
  hunks: readonly DiffHunk[];
}) {
  const additions = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "added").length,
    0,
  );
  const deletions = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "removed").length,
    0,
  );

  return (
    <div
      data-slot="reviewable-diff"
      className={cn(paper, "flex w-full max-w-md flex-col overflow-hidden rounded-2xl", className)}
      {...props}
    >
      <DiffHeader filename={filename} additions={additions} deletions={deletions} />

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
              )}
            >
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
