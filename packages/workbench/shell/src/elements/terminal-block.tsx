"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";

import { cn } from "../utils";

import { take } from "./range";

const OUTPUT_EDGE_MASK =
  "linear-gradient(to bottom, transparent 0, black 1.25rem, black calc(100% - 2rem), transparent 100%)";
const OUTPUT_BOTTOM_EDGE_MASK =
  "linear-gradient(to bottom, black 0, black calc(100% - 2rem), transparent 100%)";

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
  collapseCommandLabel: string;
  expandCommandLabel: string;
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
  collapseCommandLabel,
  expandCommandLabel,
  runningLabel,
  successLabel,
  className,
  ...props
}: TerminalBlockProps) {
  const visibleLines = take(lines, visibleCount);
  const commandTextRef = useRef<HTMLSpanElement>(null);
  const [commandExpanded, setCommandExpanded] = useState(false);
  const [commandOverflowing, setCommandOverflowing] = useState(false);
  const [showOutputTopFade, setShowOutputTopFade] = useState(false);

  useLayoutEffect(() => {
    const commandText = commandTextRef.current;
    if (!commandText || commandExpanded) return undefined;

    const measure = () => {
      const overflowing = commandText.scrollHeight > commandText.clientHeight + 1;
      setCommandOverflowing((current) => (current === overflowing ? current : overflowing));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(commandText);
    return () => observer.disconnect();
  }, [command, commandExpanded, commandOverflowing]);

  const commandContent = (
    <>
      <span aria-hidden="true" className="me-2 shrink-0 select-none text-muted-foreground/60">
        $
      </span>
      <span
        ref={commandTextRef}
        className={cn(
          "min-w-0 whitespace-pre-wrap break-normal text-foreground/65",
          !commandExpanded && "line-clamp-2",
        )}
      >
        {command}
      </span>
    </>
  );

  return (
    <div
      data-slot="terminal-block"
      aria-busy={!done}
      className={cn(
        "relative w-full overflow-hidden rounded-[var(--radius-xl)] border border-border/70 bg-muted/20 font-mono text-[13px]",
        className,
      )}
      {...props}
    >
      <div
        data-slot="terminal-block-title"
        className="flex min-h-[var(--control-hit-default)] items-center justify-between gap-2 px-3 pt-1.5 pb-1 font-sans text-sm text-muted-foreground"
      >
        <span>{title}</span>
        {titleAction}
      </div>

      {commandOverflowing ? (
        <button
          type="button"
          data-slot="terminal-block-command"
          aria-expanded={commandExpanded}
          aria-label={commandExpanded ? collapseCommandLabel : expandCommandLabel}
          className="flex w-full min-w-0 cursor-pointer rounded-sm bg-transparent px-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => setCommandExpanded((expanded) => !expanded)}
        >
          {commandContent}
        </button>
      ) : (
        <div data-slot="terminal-block-command" className="flex min-w-0 px-3">
          {commandContent}
        </div>
      )}

      <div
        data-slot="terminal-block-scroll-area"
        className="relative mt-1 min-h-12 max-h-[240px] overflow-auto"
        onScroll={(event) => setShowOutputTopFade(event.currentTarget.scrollTop > 0)}
        style={{
          maskImage: showOutputTopFade ? OUTPUT_EDGE_MASK : OUTPUT_BOTTOM_EDGE_MASK,
          WebkitMaskImage: showOutputTopFade ? OUTPUT_EDGE_MASK : OUTPUT_BOTTOM_EDGE_MASK,
        }}
      >
        <div className="min-w-max px-3 pt-1 pb-10">
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
        className="absolute end-3 bottom-2 flex items-center gap-1 font-sans text-sm text-muted-foreground/60"
      >
        {done ? (
          <>
            <CheckIcon aria-hidden="true" className="aui-chat-icon-size-default" />
            <span>{successLabel}</span>
          </>
        ) : (
          <>
            <Loader2Icon
              aria-hidden="true"
              className="aui-chat-icon-size-default animate-spin motion-reduce:animate-none"
            />
            <span>{runningLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
