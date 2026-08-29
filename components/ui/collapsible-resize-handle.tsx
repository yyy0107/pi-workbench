"use client";

import {
  useCollapsibleResize,
  type UseCollapsibleResizeOptions,
} from "@/hooks/use-collapsible-resize";
import { cn } from "@/lib/utils";

export type CollapsibleResizeHandleProps = Omit<UseCollapsibleResizeOptions, "getMaximumWidth"> & {
  ariaLabel: string;
  edge: "inline-start" | "inline-end";
  maximumWidth: number;
  className?: string;
  dataSlot?: string;
};

export function CollapsibleResizeHandle({
  ariaLabel,
  className,
  dataSlot = "collapsible-resize-handle",
  edge,
  maximumWidth,
  ...resizeOptions
}: CollapsibleResizeHandleProps) {
  const resize = useCollapsibleResize({
    ...resizeOptions,
    getMaximumWidth: () => maximumWidth,
  });

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={Math.round(resizeOptions.minimumWidth)}
      aria-valuemax={Math.round(maximumWidth)}
      aria-valuenow={Math.round(resizeOptions.width)}
      data-edge={edge}
      data-slot={dataSlot}
      className={cn(
        "group absolute inset-y-0 z-40 w-[10px] touch-none cursor-col-resize outline-none [app-region:no-drag] after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:blur-[0.35px] hover:after:bg-ring/30 focus-visible:after:bg-ring/50",
        edge === "inline-start" ? "-start-[5px]" : "-end-[5px]",
        className,
      )}
      onPointerDown={resize.onPointerDown}
      onPointerMove={resize.onPointerMove}
      onPointerUp={resize.onPointerUp}
      onPointerCancel={resize.onPointerCancel}
      onKeyDown={resize.onKeyDown}
    />
  );
}
