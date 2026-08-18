"use client";

import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

import { mono, mutedPaper } from "./surfaces";
import { take } from "./range";

const MAX_RENDERED_LINES = 200;

export function TerminalBlock({
  command,
  lines,
  visibleCount,
  done,
  headerAction,
  variant = "paper",
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "command" | "lines" | "visibleCount" | "done" | "variant"
> & {
  command: string;
  lines: readonly string[];
  visibleCount: number;
  done: boolean;
  headerAction?: ReactNode;
  variant?: "paper" | "ink";
}) {
  const ink = variant === "ink";
  const outputRef = useRef<HTMLDivElement>(null);
  const shown = take(lines, visibleCount);
  const firstRenderedIndex = Math.max(0, shown.length - MAX_RENDERED_LINES);
  const renderedLines = shown.slice(firstRenderedIndex);

  useLayoutEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [done, visibleCount]);

  return (
    <div
      data-slot="terminal-block"
      aria-busy={!done}
      className={cn(
        ink
          ? "bg-foreground dark:bg-popover shadow-[0_12px_32px_-16px_rgba(0,0,0,0.35)] dark:shadow-none"
          : mutedPaper,
        "w-full overflow-hidden rounded-2xl border border-blue-500/20 font-mono text-xs dark:border-blue-400/20",
        className,
      )}

      {...props}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 px-4 pt-3 pb-1.5">
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            ink ? "text-background/90 dark:text-foreground/90" : "text-foreground/90",
          )}
        >
          {command}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {!done ? (
            <Loader2Icon
              aria-hidden="true"
              className={cn(
                "size-3 animate-spin motion-reduce:animate-none",
                ink ? "text-background/35 dark:text-foreground/35" : "text-foreground/35",
              )}
            />
          ) : null}
          {headerAction}
        </div>
      </div>
      <div
        data-slot="terminal-block-output"
        ref={outputRef}
        className={cn(
          "flex max-h-64 flex-col gap-1 overflow-y-auto px-4 pt-1 pb-3.5",
          ink ? "text-background/55 dark:text-foreground/50" : "text-foreground/50",
        )}
      >
        {firstRenderedIndex > 0 ? <div aria-hidden="true">…</div> : null}
        {renderedLines.map((line, i) => {
          const lineIndex = firstRenderedIndex + i;
          const isLast = lineIndex === shown.length - 1;
          return (
            <div
              key={`${lineIndex}-${line}`}
              className={cn(
                !done && isLast && "fade-in animate-in fill-mode-both duration-300",
                isLast &&
                  (ink ? "text-background/90 dark:text-foreground/90" : "text-foreground/90"),
              )}
            >
              {line}
            </div>
          );
        })}
        {!done && (
          <span
            aria-hidden
            className="inline-block h-3 w-1.5 animate-pulse bg-blue-500/70 motion-reduce:animate-none dark:bg-blue-400/70"
          />
        )}
        {done ? (
          <div
            data-slot="terminal-block-status"
            className={cn(
              mono,
              "mt-auto inline-flex shrink-0 self-end whitespace-nowrap pt-2",
              ink ? "text-background/40 dark:text-foreground/40" : "text-foreground/40",
            )}
          >
            <CheckIcon aria-hidden="true" className="mr-1 size-3 text-emerald-500" />
            exit 0
          </div>
        ) : null}
      </div>
    </div>
  );
}
