"use client";

import type { ReactNode } from "react";
import { CheckIcon, ChevronRightIcon, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { collapsePanel, field, mono, ShimmerLabel } from "./surfaces";

export interface ToolCallProps {
  label: string;
  activeLabel: string;
  query: string;
  request: string;
  result: string;
  requestLabel: string;
  resultLabel: string;
  icon?: LucideIcon;
  running: boolean;
  elapsed?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
  className?: string;
}

export function ToolCall({
  label,
  activeLabel,
  query,
  request,
  result,
  requestLabel,
  resultLabel,
  icon: Icon,
  running,
  elapsed,
  open,
  onOpenChange,
  children,
  className,
}: ToolCallProps) {
  return (
    <Collapsible
      data-slot="tool-call"
      aria-busy={running}
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-full", className)}
    >
      <CollapsibleTrigger className="group/trigger text-foreground/55 hover:text-foreground/90 flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-[13.5px] transition-colors outline-none">
        {Icon && (
          <Icon
            data-slot="tool-call-icon"
            aria-hidden="true"
            className="text-foreground/45 size-3.5 shrink-0"
          />
        )}
        <span className="flex min-w-0 items-center">
          <ShimmerLabel
            active={running}
            className="relative shrink-0 whitespace-nowrap leading-none"
          >
            {running ? activeLabel : label}
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
        {!running && (
          <CheckIcon className="fade-in zoom-in-90 animate-in size-3.5 shrink-0 text-emerald-500 duration-200" />
        )}
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/trigger:opacity-60 group-focus-visible/trigger:opacity-60 group-data-open/trigger:rotate-90 group-data-open/trigger:opacity-60 group-data-panel-open/trigger:rotate-90 group-data-panel-open/trigger:opacity-60 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        {children ? (
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
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
