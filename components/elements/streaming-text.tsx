"use client";

import { type ComponentProps, useMemo } from "react";
import { cn } from "@/lib/utils";
import { take } from "./range";

export interface Segment {
  text: string;
  mono?: boolean;
}

interface WordRun {
  text: string;
  mono: boolean;
}

const ANIMATED_WORD_COUNT = 2;

function groupWords(words: readonly { word: string; mono: boolean }[]): WordRun[] {
  const runs: WordRun[] = [];

  for (const { word, mono: isMono } of words) {
    const previous = runs.at(-1);
    if (previous?.mono === isMono) {
      previous.text += `${word} `;
    } else {
      runs.push({ text: `${word} `, mono: isMono });
    }
  }

  return runs;
}

export function StreamingText({
  segments,
  count,
  streaming,
  className,
  ...props
}: Omit<ComponentProps<"p">, "children" | "segments" | "count" | "streaming"> & {
  segments: Segment[];
  count: number;
  streaming: boolean;
}) {
  const words = useMemo(
    () =>
      segments.flatMap((segment) =>
        segment.text.split(" ").map((word) => ({ word, mono: segment.mono ?? false })),
      ),
    [segments],
  );
  const shown = take(words, count);
  const animatedStart = streaming ? Math.max(0, shown.length - ANIMATED_WORD_COUNT) : shown.length;
  const settledRuns = groupWords(shown.slice(0, animatedStart));
  const animatedWords = shown.slice(animatedStart);

  return (
    <p
      data-slot="streaming-text"
      className={cn("min-h-[8.5rem] max-w-sm text-sm leading-relaxed text-pretty", className)}
      {...props}
    >
      {settledRuns.map((run, index) => (
        <span
          key={`${index}-${run.mono}`}
          className={cn(
            run.mono && "bg-foreground/[0.06] rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
          )}
        >
          {run.text}
        </span>
      ))}
      {animatedWords.map(({ word, mono: isMono }, index) => {
        const isLast = index === animatedWords.length - 1;

        return (
          <span
            key={`animated-${animatedStart + index}`}
            className="fade-in animate-in fill-mode-both text-blue-500 duration-500 motion-reduce:animate-none dark:text-blue-400"
          >
            <span
              className={cn(
                "transition-colors duration-700 motion-reduce:transition-none",
                isMono && "bg-foreground/[0.06] rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
              )}
            >
              {word}
            </span>
            {streaming && isLast ? (
              <span
                data-slot="streaming-text-caret"
                aria-hidden="true"
                className="-mb-0.5 ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400"
              />
            ) : (
              " "
            )}
          </span>
        );
      })}
    </p>
  );
}
