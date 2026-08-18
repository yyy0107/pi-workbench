"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { collapsePanel, mono, ShimmerLabel, SwapLabel } from "./surfaces";
import { take } from "./range";

export interface ReasoningStep {
  title?: ReactNode;
  body: ReactNode;
  marker?: boolean;
}

export interface ReasoningPanelProps {
  steps: ReasoningStep[];
  visibleSteps: number;
  streaming: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeLabel: string;
  restingLabel: string;
  icon?: LucideIcon;
  activeIcon?: ReactNode;
  collapsedPreview?: ReactNode;
  elapsed?: string;
  className?: string;
}

export function ReasoningPanel({
  steps,
  visibleSteps,
  streaming,
  open,
  onOpenChange,
  activeLabel,
  restingLabel,
  icon: Icon,
  activeIcon,
  collapsedPreview,
  elapsed,
  className,
}: ReasoningPanelProps) {
  const shown = take(steps, visibleSteps);

  return (
    <Collapsible
      data-slot="reasoning-panel"
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-full", className)}
    >
      <CollapsibleTrigger className="group/trigger text-foreground/55 hover:text-foreground/90 flex w-full items-center gap-1.5 py-1 text-[13.5px] transition-[color,scale] outline-none active:scale-[0.995]">
        {streaming && activeIcon !== undefined ? (
          <span
            data-slot="reasoning-panel-icon"
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center"
          >
            {activeIcon}
          </span>
        ) : Icon ? (
          <Icon
            data-slot="reasoning-panel-icon"
            aria-hidden="true"
            className="text-foreground/45 size-3.5 shrink-0"
          />
        ) : null}
        <SwapLabel active={streaming ? 0 : 1} className="text-start">
          <>
            <ShimmerLabel active={streaming} className="relative inline-block leading-none">
              {activeLabel}
            </ShimmerLabel>
            {elapsed !== undefined && (
              <span className={cn(mono, "text-foreground/30 tabular-nums")}>{elapsed}</span>
            )}
          </>
          <>{restingLabel}</>
        </SwapLabel>
        {!open && collapsedPreview !== undefined && (
          <span
            data-slot="reasoning-panel-preview"
            title={typeof collapsedPreview === "string" ? collapsedPreview : undefined}
            className="text-foreground/45 min-w-0 flex-1 truncate text-start leading-none"
          >
            {collapsedPreview}
          </span>
        )}
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/trigger:opacity-60 group-focus-visible/trigger:opacity-60 group-data-open/trigger:rotate-90 group-data-open/trigger:opacity-60 group-data-panel-open/trigger:rotate-90 group-data-panel-open/trigger:opacity-60 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "w-full outline-none")}>
        <ol className="flex w-full flex-col gap-4 pt-3 pb-1">
          {shown.map((step, i) => {
            const active = streaming && i === shown.length - 1;
            return (
              <li
                key={i}
                className={cn(
                  "fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex w-full duration-300",
                  step.marker !== false && "gap-3",
                )}
              >
                {step.marker !== false && (
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[7px] size-[5px] shrink-0 rounded-full transition-colors duration-300",
                      active ? "animate-pulse bg-blue-500 dark:bg-blue-400" : "bg-foreground/20",
                    )}
                  />
                )}
                <span className="flex w-full min-w-0 flex-1 flex-col">
                  {step.title !== undefined && (
                    <p className="text-foreground/90 text-[13.5px] font-medium">{step.title}</p>
                  )}
                  <div
                    className={cn(
                      "text-foreground/50 text-[13px] leading-relaxed break-words",
                      step.title !== undefined && "mt-0.5",
                    )}
                  >
                    {step.body}
                  </div>
                </span>
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
