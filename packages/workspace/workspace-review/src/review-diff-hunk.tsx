"use client";
import { useI18n } from "@workbench/i18n";
import { Button, Collapsible, CollapsibleTrigger, CollapsibleContent } from "@workbench/ui";
import { reviewTranslationBundle } from "./i18n";
import { reviewContextSections } from "../lib/review-context";
import { memo, useMemo, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { WorkbenchHighlightedTokens } from "@workbench/code-highlighting/engine";
import { tokenStyle } from "@workbench/code-highlighting";
import { DiffContextSummary, numberedHunkLines, type DiffHunk } from "@workbench/code-highlighting";

import { reviewWordRanges, type ReviewDisplayOptions, type WordRange } from "../lib/review-options";

function decoratedText(
  text: string,
  start: number,
  ranges: readonly WordRange[],
  whitespace: boolean,
) {
  if (!ranges.length && !whitespace) return text;
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

function ReviewContextLines({ count, children }: { count: number; children: () => ReactNode }) {
  const { t } = useI18n(reviewTranslationBundle);
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="review-context-toggle">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              data-selection="none"
              className="w-full justify-start bg-muted/40 font-normal text-muted-foreground"
            />
          }
        >
          {open ? (
            <ChevronDownIcon aria-hidden className="size-(--icon-size-sm)" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-(--icon-size-sm)" />
          )}
          {t("extensions.workspaceReview.unmodifiedLines", { count })}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>{open && children()}</CollapsibleContent>
    </Collapsible>
  );
}

export const ReviewDiffHunk = memo(function ReviewDiffHunk({
  hunk,
  options,
  tokens,
}: {
  hunk: DiffHunk;
  options: ReviewDisplayOptions;
  tokens?: WorkbenchHighlightedTokens;
}) {
  const { t } = useI18n(reviewTranslationBundle);
  const sections = useMemo(() => reviewContextSections(hunk.lines), [hunk.lines]);
  const words = useMemo(
    () =>
      options.wordDiff ? reviewWordRanges(hunk.lines) : new Map<number, readonly WordRange[]>(),
    [hunk.lines, options.wordDiff],
  );
  const lines = useMemo(() => numberedHunkLines(hunk), [hunk]);
  const renderLines = (start: number, end: number) =>
    lines.slice(start, end).map(({ line, oldLine, newLine }, sectionIndex) => {
      const index = start + sectionIndex;
      let offset = 0;
      const ranges = words.get(index) ?? [];
      return (
        <div key={index} data-review-row="" data-kind={line.kind}>
          <span aria-hidden className="review-line-number">
            {newLine ?? oldLine}
          </span>
          {line.kind !== "context" && (
            <span className="sr-only select-none">
              {t(
                line.kind === "added"
                  ? "extensions.workspaceReview.change.added"
                  : "extensions.workspaceReview.change.deleted",
              )}
            </span>
          )}
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
        </div>
      );
    });

  return (
    <div data-review-hunk="" data-wrap={options.wrap || undefined}>
      <DiffContextSummary count={hunk.hiddenContextBefore} />
      <div data-review-code="">
        {sections.map(({ start, end, collapsed }) =>
          collapsed ? (
            <ReviewContextLines key={start} count={end - start}>
              {() => renderLines(start, end)}
            </ReviewContextLines>
          ) : (
            <div key={start}>{renderLines(start, end)}</div>
          ),
        )}
      </div>
    </div>
  );
});
