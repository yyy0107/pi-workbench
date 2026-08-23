"use client";

import type { ComponentProps, ReactNode } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

import { take } from "./range";

export type TerminalBlockProps = Omit<
  ComponentProps<"div">,
  "children" | "command" | "lines" | "visibleCount" | "done" | "title"
> & {
  command: string;
  lines: readonly string[];
  visibleCount: number;
  done: boolean;
  title: string;
  titleAction?: ReactNode;
  runningLabel: string;
  successLabel: string;
};

export function TerminalBlock({
  command,
  lines,
  visibleCount,
  done,
  title,
  titleAction,
  runningLabel,
  successLabel,
  className,
  ...props
}: TerminalBlockProps) {
  const visibleLines = take(lines, visibleCount);

  return (
    <div
      data-slot="terminal-block"
      aria-busy={!done}
      className={cn(
        "relative w-full overflow-hidden rounded-[14px] border border-border/70 bg-muted/20 font-mono text-[13px]",
        className,
      )}
      {...props}
    >
      <div
        data-slot="terminal-block-title"
        className="flex min-h-8 items-center justify-between gap-2 px-3 pt-1.5 pb-1 font-sans text-sm text-muted-foreground"
      >
        <span>{title}</span>
        {titleAction}
      </div>

      <div
        data-slot="terminal-block-scroll-area"
        className="relative max-h-[280px] overflow-auto [scrollbar-width:thin]"
      >
        <div className="min-w-max px-3 pb-10">
          <div data-slot="terminal-block-command" className="flex whitespace-pre">
            <span aria-hidden="true" className="me-2 select-none text-muted-foreground/60">
              $
            </span>
            <span className="text-foreground/65">{command}</span>
          </div>

          <div aria-hidden="true" className="h-3" />

          <div data-slot="terminal-block-output" className="whitespace-pre text-foreground/60">
            {visibleLines.map((line, index) => (
              <div
                key={`${index}-${line}`}
                className="fade-in animate-in min-h-[1.35rem] duration-200"
              >
                {line || " "}
              </div>
            ))}

            {!done && (
              <span
                aria-hidden="true"
                className="mt-1 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/30 motion-reduce:animate-none"
              />
            )}
          </div>
        </div>
      </div>

      <div
        data-slot="terminal-block-status"
        aria-live="polite"
        className="absolute end-3 bottom-2 flex items-center gap-1 bg-muted/85 ps-2 font-sans text-sm text-muted-foreground/60 backdrop-blur-sm"
      >
        {done ? (
          <>
            <CheckIcon aria-hidden="true" className="size-4" />
            <span>{successLabel}</span>
          </>
        ) : (
          <>
            <Loader2Icon
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            <span>{runningLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
