"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import type { PanelLocation } from "@/platform/extensions";
import { cn } from "@/lib/utils";

const KEYBOARD_STEP = 16;

interface ResizeStart {
  pointerId: number;
  x: number;
  y: number;
  size: number;
}

export interface PanelResizeHandleProps {
  location: PanelLocation;
  size: number;
  minSize?: number;
  maxSize?: number;
  onResize: (size: number) => void;
  className?: string;
}

function pointerDelta(
  location: PanelLocation,
  start: ResizeStart,
  event: ReactPointerEvent<HTMLDivElement>,
) {
  if (location === "left") return event.clientX - start.x;
  if (location === "right") return start.x - event.clientX;
  return start.y - event.clientY;
}

export function PanelResizeHandle({
  location,
  size,
  minSize = 0,
  maxSize,
  onResize,
  className,
}: PanelResizeHandleProps) {
  const startRef = useRef<ResizeStart | null>(null);
  const isVertical = location !== "bottom";

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    startRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${location} panel`}
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(size)}
      aria-valuemin={Math.round(minSize)}
      aria-valuemax={maxSize === undefined ? undefined : Math.round(maxSize)}
      data-slot="workbench-panel-resize-handle"
      data-location={location}
      className={cn(
        "group absolute z-20 touch-none outline-none",
        "after:bg-border after:absolute after:transition-colors group-hover:after:bg-ring group-focus-visible:after:bg-ring",
        location === "left" &&
          "inset-y-0 -right-1 w-2 cursor-col-resize after:inset-y-0 after:left-1/2 after:w-px",
        location === "right" &&
          "inset-y-0 -left-1 w-2 cursor-col-resize after:inset-y-0 after:left-1/2 after:w-px",
        location === "bottom" &&
          "inset-x-0 -top-1 h-2 cursor-row-resize after:inset-x-0 after:top-1/2 after:h-px",
        className,
      )}
      onPointerDown={(event) => {
        startRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          size,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = startRef.current;
        if (!start || start.pointerId !== event.pointerId) return;
        onResize(start.size + pointerDelta(location, start, event));
      }}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      onKeyDown={(event) => {
        let delta = 0;

        if (location === "left") {
          if (event.key === "ArrowLeft") delta = -KEYBOARD_STEP;
          if (event.key === "ArrowRight") delta = KEYBOARD_STEP;
        } else if (location === "right") {
          if (event.key === "ArrowLeft") delta = KEYBOARD_STEP;
          if (event.key === "ArrowRight") delta = -KEYBOARD_STEP;
        } else {
          if (event.key === "ArrowUp") delta = KEYBOARD_STEP;
          if (event.key === "ArrowDown") delta = -KEYBOARD_STEP;
        }

        if (delta === 0) return;
        event.preventDefault();
        onResize(size + delta);
      }}
    />
  );
}
