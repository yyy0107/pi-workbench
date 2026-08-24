"use client";

import type { ReactNode } from "react";
import { CheckIcon, ChevronRightIcon, CircleXIcon, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { collapsePanel, field, mono, ShimmerLabel } from "./surfaces";
import { useDisclosureScrollLock } from "./use-disclosure-scroll-lock";

export interface ToolCallProps {
  label: string;
  activeLabel: string;
  query: string;
  summary?: ReactNode;
  request: string;
  result: string;
  requestLabel: string;
  resultLabel: string;
  icon?: LucideIcon;
  /** Optional optical-size correction for glyphs with unusually inset viewBox artwork. */
  iconClassName?: string;
  running: boolean;
  failed?: boolean;
  failedLabel?: string;
  elapsed?: string;
  showCompletionIcon?: boolean;
  expandable?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disclosureController?: (controls: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => ReactNode;
  children?: ReactNode;
  className?: string;
}

export function ToolCall({
  label,
  activeLabel,
  query,
  summary,
  request,
  result,
  requestLabel,
  resultLabel,
  icon: Icon,
  iconClassName,
  running,
  failed = false,
  failedLabel,
  elapsed,
  showCompletionIcon = true,
  expandable = true,
  open,
  onOpenChange,
  disclosureController,
  children,
  className,
}: ToolCallProps) {
  const [rootRef, handleOpenChange] = useDisclosureScrollLock(onOpenChange);
  const hasCustomSummary = summary !== undefined;
  const summaryContent = (
    <>
      {Icon && (
        <Icon
          data-slot="tool-call-icon"
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0",
            hasCustomSummary ? "text-current" : "text-foreground/45",
            iconClassName,
          )}
        />
      )}
      {summary ?? (
        <span className="flex min-w-0 items-center">
          <ShimmerLabel
            active={running}
            className={cn(
              "relative shrink-0 whitespace-nowrap leading-none",
              failed && "text-destructive",
            )}
          >
            {running ? activeLabel : failed ? (failedLabel ?? label) : label}
          </ShimmerLabel>
          {elapsed !== undefined && (
            <span className={cn(mono, "text-foreground/30 shrink-0 tabular-nums")}>{elapsed}</span>
          )}
          <span
            title={query}
            className={cn(
              mono,
              "text-foreground/70 min-w-0 truncate",
              elapsed === undefined && "ms-1",
            )}
          >
            {query}
          </span>
        </span>
      )}
      {!running && failed ? (
        <CircleXIcon
          aria-hidden="true"
          className="fade-in zoom-in-90 animate-in text-destructive size-3.5 shrink-0 duration-200 motion-reduce:animate-none"
        />
      ) : !running && showCompletionIcon ? (
        <CheckIcon
          aria-hidden="true"
          className="fade-in zoom-in-90 animate-in size-3.5 shrink-0 text-emerald-500 duration-200 motion-reduce:animate-none"
        />
      ) : null}
    </>
  );
  const chevron = expandable ? (
    <ChevronRightIcon className="size-3.5 shrink-0 opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/trigger:opacity-60 group-focus-visible/trigger:opacity-60 group-data-open/trigger:rotate-90 group-data-open/trigger:opacity-60 group-data-panel-open/trigger:rotate-90 group-data-panel-open/trigger:opacity-60 motion-reduce:transition-none" />
  ) : null;
  const detailContent = children ? (
    <div className="mt-2 min-w-0">{children}</div>
  ) : (
    <div className={cn(field, "mt-2 overflow-hidden rounded-2xl text-xs")}>
      <div className="px-3.5 pt-2.5 pb-2">
        <p className={cn(mono, "text-foreground/35 mb-1")}>{requestLabel}</p>
        <pre className="text-foreground/55 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">
          {request}
        </pre>
      </div>
      <div className="bg-foreground/[0.06] mx-3.5 h-px" />
      <div className="px-3.5 pt-2 pb-2.5">
        <p className={cn(mono, "text-foreground/35 mb-1")}>{resultLabel}</p>
        <pre className="text-foreground/90 max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans">
          {result}
        </pre>
      </div>
    </div>
  );
  const controlledDisclosure = disclosureController?.({
    open,
    onOpenChange: handleOpenChange,
  });

  if (!expandable) {
    return (
      <div
        data-slot="tool-call"
        data-status={failed ? "error" : running ? "running" : "complete"}
        aria-busy={running}
        className={cn("w-full", className)}
      >
        <div
          data-slot="tool-call-summary"
          className="group/trigger text-foreground/55 hover:text-foreground/90 flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-[13.5px] transition-colors outline-none"
        >
          {summaryContent}
          {chevron}
        </div>
      </div>
    );
  }

  if (hasCustomSummary) {
    return (
      <>
        {controlledDisclosure}
        <Collapsible
          ref={rootRef}
          data-slot="tool-call"
          data-status={failed ? "error" : running ? "running" : "complete"}
          aria-busy={running}
          open={open}
          onOpenChange={handleOpenChange}
          className={cn("w-full", className)}
        >
          <div
            data-slot="tool-call-summary"
            className="group/tool-summary relative flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-[13.5px] outline-none"
          >
            <CollapsibleTrigger
              aria-label={`${running ? activeLabel : failed ? (failedLabel ?? label) : label} ${query}`.trim()}
              className="peer/trigger absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-1.5 text-foreground/55 [--tool-diff-additions:currentColor] [--tool-diff-deletions:currentColor] transition-colors group-hover/tool-summary:text-foreground group-hover/tool-summary:[--tool-diff-additions:var(--color-emerald-600)] group-hover/tool-summary:[--tool-diff-deletions:var(--color-red-600)] group-focus-within/tool-summary:text-foreground group-focus-within/tool-summary:[--tool-diff-additions:var(--color-emerald-600)] group-focus-within/tool-summary:[--tool-diff-deletions:var(--color-red-600)] dark:group-hover/tool-summary:[--tool-diff-additions:var(--color-emerald-400)] dark:group-hover/tool-summary:[--tool-diff-deletions:var(--color-red-400)] dark:group-focus-within/tool-summary:[--tool-diff-additions:var(--color-emerald-400)] dark:group-focus-within/tool-summary:[--tool-diff-deletions:var(--color-red-400)]">
              {summaryContent}
            </div>
            <ChevronRightIcon className="pointer-events-none relative z-10 size-3.5 shrink-0 opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] peer-hover/trigger:opacity-60 peer-focus-visible/trigger:opacity-60 peer-data-open/trigger:rotate-90 peer-data-open/trigger:opacity-60 peer-data-panel-open/trigger:rotate-90 peer-data-panel-open/trigger:opacity-60 motion-reduce:transition-none" />
          </div>
          <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
            {detailContent}
          </CollapsibleContent>
        </Collapsible>
      </>
    );
  }

  return (
    <>
      {controlledDisclosure}
      <Collapsible
        ref={rootRef}
        data-slot="tool-call"
        data-status={failed ? "error" : running ? "running" : "complete"}
        aria-busy={running}
        open={open}
        onOpenChange={handleOpenChange}
        className={cn("w-full", className)}
      >
        <CollapsibleTrigger className="group/trigger text-foreground/55 hover:text-foreground/90 flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-[13.5px] transition-colors outline-none">
          {summaryContent}
          {chevron}
        </CollapsibleTrigger>
        <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
          {detailContent}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
