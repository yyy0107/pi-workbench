"use client";

import { type ComponentProps, useMemo } from "react";

import { cn } from "../utils";

import { take } from "./range";

export interface Segment {
  text: string;
  mono?: boolean;
}

const MULTILINGUAL_WORD_PATTERN =
  /\p{Script=Han}{1,3}|(?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}])+(?:['’](?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}])+)*|[^\p{L}\p{M}\p{N}]+/gu;

export function StreamingText({
  segments,
  count,
  streaming,
  granularity = "word",
  className,
  ...props
}: Omit<ComponentProps<"p">, "children"> & {
  segments: readonly Segment[];
  count: number;
  streaming: boolean;
  granularity?: "word" | "multilingual-word";
}) {
  const words = useMemo(
    () =>
      segments.flatMap((segment) =>
        (granularity === "multilingual-word"
          ? (segment.text.match(MULTILINGUAL_WORD_PATTERN) ?? [])
          : segment.text.split(" ")
        ).map((word) => ({
          word,
          wordLike: /[\p{L}\p{N}]/u.test(word),
          mono: segment.mono ?? false,
        })),
      ),
    [granularity, segments],
  );
  const shown = take(words, count);
  const freshWordCount = granularity === "multilingual-word" ? 4 : 2;
  const wordIndices = shown.flatMap(({ wordLike }, index) => (wordLike ? [index] : []));
  const freshFrom = wordIndices.at(-freshWordCount) ?? shown.length;

  return (
    <p
      data-slot="streaming-text"
      className={cn("min-h-[8.5rem] max-w-sm text-sm leading-relaxed text-pretty", className)}
      {...props}
    >
      {shown.map(({ word, mono }, index) => {
        const fresh = streaming && index >= freshFrom;

        return (
          <span
            key={index}
            className="fade-in animate-in fill-mode-both duration-500 motion-reduce:animate-none"
          >
            <span
              className={cn(
                "transition-colors duration-700 motion-reduce:transition-none",
                fresh && "text-blue-500 dark:text-blue-400",
                mono && "bg-foreground/[0.06] rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
              )}
            >
              {word}
            </span>
            {granularity === "word" ? " " : null}
          </span>
        );
      })}
      {streaming && shown.length > 0 ? (
        <span
          aria-hidden
          className="-mb-0.5 ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none dark:bg-blue-400"
        />
      ) : null}
    </p>
  );
}
