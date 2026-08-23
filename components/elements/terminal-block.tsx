"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, Loader2Icon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { collapsePanel, mono, mutedPaper } from "./surfaces";
import { take } from "./range";
import { useDisclosureScrollLock } from "./use-disclosure-scroll-lock";

const MAX_RENDERED_LINES = 200;
const TOP_BOUNDARY_MASK = "linear-gradient(to bottom, black, transparent)";
const BOTTOM_BOUNDARY_MASK = "linear-gradient(to top, black, transparent)";

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
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandDisclosureRef, handleCommandOpenChange] = useDisclosureScrollLock(setCommandOpen);
  const outputRef = useRef<HTMLDivElement>(null);
  const [commandFirstLine = "", ...commandRestLines] = command.split(/\r\n?|\n/);
  const commandRemainder = commandRestLines.join("\n");
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
      <Collapsible
        ref={commandDisclosureRef}
        data-slot="terminal-block-command"
        open={commandOpen}
        onOpenChange={handleCommandOpenChange}
      >
        <div className="flex min-h-6 min-w-0 items-start justify-between gap-2 px-4">
          <CollapsibleTrigger
            data-slot="terminal-block-command-trigger"
            className={cn(
              "group/command flex min-h-6 min-w-0 flex-1 gap-1.5 rounded-sm text-start outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
              commandOpen ? "items-start" : "items-center",
              ink ? "text-background/90 dark:text-foreground/90" : "text-foreground/90",
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1",
                commandOpen ? "py-1 whitespace-pre-wrap break-all" : "truncate",
              )}
            >
              {commandOpen ? commandFirstLine : command}
            </span>
            {commandOpen ? (
              <ChevronUpIcon
                aria-hidden="true"
                className="mt-[5px] size-3.5 shrink-0 opacity-60 transition-opacity duration-150 group-hover/command:opacity-90 motion-reduce:transition-none"
              />
            ) : (
              <ChevronDownIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover/command:opacity-60 group-focus-visible/command:opacity-60 motion-reduce:transition-none"
              />
            )}
          </CollapsibleTrigger>
          <div className="flex h-6 shrink-0 items-center gap-1.5">
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
        {commandRemainder ? (
          <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
            <pre
              data-slot="terminal-block-command-content"
              className={cn(
                "max-h-48 overflow-auto whitespace-pre-wrap break-all px-4 pt-1 pb-2 font-mono text-xs",
                ink ? "text-background/70 dark:text-foreground/70" : "text-foreground/70",
              )}
            >
              {commandRemainder}
            </pre>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
      <div data-slot="terminal-block-output-region" className="relative">
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
        </div>
        <div
          data-slot="terminal-block-boundary-fade"
          data-side="top"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3 supports-backdrop-filter:backdrop-blur-[0.5px]"
          style={{ maskImage: TOP_BOUNDARY_MASK, WebkitMaskImage: TOP_BOUNDARY_MASK }}
        />
        <div
          data-slot="terminal-block-boundary-fade"
          data-side="bottom"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3 supports-backdrop-filter:backdrop-blur-[0.5px]"
          style={{ maskImage: BOTTOM_BOUNDARY_MASK, WebkitMaskImage: BOTTOM_BOUNDARY_MASK }}
        />
      </div>
      <div
        data-slot="terminal-block-footer"
        className={cn(
          mono,
          "flex h-6 shrink-0 items-center justify-end px-4",
          ink ? "text-background/40 dark:text-foreground/40" : "text-foreground/40",
        )}
      >
        {done ? (
          <div data-slot="terminal-block-status" className="inline-flex whitespace-nowrap">
            <CheckIcon aria-hidden="true" className="mr-1 size-3 text-emerald-500" />
            exit 0
          </div>
        ) : null}
      </div>
    </div>
  );
}
