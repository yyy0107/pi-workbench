"use client";

import { useMemo } from "react";
import { useWorkbenchHighlightedLines } from "../../../code-highlighting/use-workbench-highlighted-lines";
import { languageForFilename } from "../../../code-highlighting/shiki-catalog";
import { shouldHighlightWorkbenchCode } from "../../../code-highlighting/code-highlight-policy";
import { tokenStyle } from "../../../code-highlighting/shiki-token-style";
import {
  DiffContextSummary,
  numberedHunkLines,
  type DiffHunk,
} from "../../../elements/reviewable-diff";
import { InlineFeedbackForm } from "../../../right-workspace/presentation";
import { useI18n } from "../../../i18n";
import type { WorkspaceSurfaceInstance } from "@workbench/extension-sdk";
import type { WorkbenchWorkspaceGitDiffRequest } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { reviewWordRanges, type ReviewDisplayOptions, type WordRange } from "./review-options";

function decoratedText(
  text: string,
  start: number,
  ranges: readonly WordRange[],
  whitespace: boolean,
) {
  const boundaries = new Set([0, text.length]);
  for (const [from, to] of ranges) {
    if (from > start && from < start + text.length) boundaries.add(from - start);
    if (to > start && to < start + text.length) boundaries.add(to - start);
  }
  if (whitespace)
    for (const match of text.matchAll(/[ \t]/g)) {
      boundaries.add(match.index);
      boundaries.add(match.index + 1);
    }
  const points = [...boundaries].sort((a, b) => a - b);
  return points.slice(0, -1).map((from, index) => {
    const value = text.slice(from, points[index + 1]);
    return (
      <span
        key={from}
        data-review-word={
          ranges.some(([left, right]) => start + from >= left && start + from < right) || undefined
        }
        data-review-space={
          whitespace && value === " " ? "space" : whitespace && value === "\t" ? "tab" : undefined
        }
      >
        {value}
      </span>
    );
  });
}

export function ReviewDiffHunk({
  hunk,
  filename,
  surface,
  request,
  options,
}: {
  hunk: DiffHunk;
  filename: string;
  surface: WorkspaceSurfaceInstance;
  request: WorkbenchWorkspaceGitDiffRequest;
  options: ReviewDisplayOptions;
}) {
  const { t } = useI18n();
  const code = useMemo(() => hunk.lines.map((line) => line.text).join("\n"), [hunk.lines]);
  const { tokens } = useWorkbenchHighlightedLines(code, languageForFilename(filename), {
    enabled: shouldHighlightWorkbenchCode(code),
  });
  const words = useMemo(
    () =>
      options.wordDiff ? reviewWordRanges(hunk.lines) : new Map<number, readonly WordRange[]>(),
    [hunk.lines, options.wordDiff],
  );
  const lines = useMemo(() => numberedHunkLines(hunk), [hunk]);
  return (
    <div data-review-hunk="" data-wrap={options.wrap || undefined}>
      <div className="bg-muted px-3 py-1 font-mono text-xs text-muted-foreground">{hunk.range}</div>
      <DiffContextSummary count={hunk.hiddenContextBefore} />
      <div className="overflow-x-auto">
        <div data-review-code="">
          {lines.map(({ line, oldLine, newLine }, index) => {
            let offset = 0;
            const ranges = words.get(index) ?? [];
            return (
              <div key={index} data-review-row="" data-kind={line.kind}>
                <span aria-hidden className="review-line-number" data-side="old">
                  {oldLine}
                </span>
                <span aria-hidden className="review-line-number" data-side="new">
                  {newLine}
                </span>
                <span aria-hidden className="review-line-marker">
                  {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
                </span>
                <code>
                  {tokens?.[index]
                    ? tokens[index].map((token, tokenIndex) => {
                        const start = offset;
                        offset += token.content.length;
                        return (
                          <span key={tokenIndex} style={tokenStyle(token)}>
                            {decoratedText(token.content, start, ranges, options.whitespace)}
                          </span>
                        );
                      })
                    : decoratedText(line.text || " ", 0, ranges, options.whitespace)}
                </code>
                <div className="review-line-feedback">
                  <InlineFeedbackForm
                    surface={surface}
                    kind="diff-line"
                    label={t("extensions.workspaceReview.commentLine")}
                    target={{
                      path: filename,
                      side: line.kind === "removed" ? "old" : "new",
                      line: newLine ?? oldLine,
                      reviewScope: request.scope,
                      revision: request.revision,
                      baseRevision: request.baseRevision,
                      sessionId: request.sessionId,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <DiffContextSummary count={hunk.hiddenContextAfter} />
    </div>
  );
}
