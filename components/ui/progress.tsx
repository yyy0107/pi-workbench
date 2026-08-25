"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

import { cn } from "@/lib/utils";

function Progress({
  className,
  trackClassName,
  indicatorClassName,
  ...props
}: ProgressPrimitive.Root.Props & {
  trackClassName?: string;
  indicatorClassName?: string;
}) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn("w-full", className)} {...props}>
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className={cn("bg-muted h-1.5 overflow-hidden rounded-full", trackClassName)}
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn(
            "bg-primary h-full rounded-full transition-[width] duration-300 data-indeterminate:w-full data-indeterminate:animate-pulse motion-reduce:animate-none motion-reduce:transition-none",
            indicatorClassName,
          )}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
