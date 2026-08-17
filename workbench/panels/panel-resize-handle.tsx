"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import type { PanelLocation } from "@/platform/extensions";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const KEYBOARD_STEP = 16;
const DETACH_ANIMATION_MS = 150;

interface ResizeSession {
  pointerId: number;
  x: number;
  y: number;
  startSize: number;
  snapThreshold: number;
  isSnapped: boolean;
  isDetaching: boolean;
  latestSize: number;
  detachTimer?: number;
}

export interface PanelResizeHandleProps {
  location: PanelLocation;
  size: number;
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  onResize: (size: number) => void;
  onCollapse?: () => void;
  onExpand?: () => void;
  onResizingChange?: (resizing: boolean) => void;
  onResizeSessionChange?: (active: boolean) => void;
  className?: string;
}

function pointerDelta(
  location: PanelLocation,
  start: ResizeSession,
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
  collapsible = false,
  onResize,
  onCollapse,
  onExpand,
  onResizingChange,
  onResizeSessionChange,
  className,
}: PanelResizeHandleProps) {
  const { t } = useI18n();
  const sessionRef = useRef<ResizeSession | null>(null);
  const isVertical = location !== "bottom";
  const locationLabel = t(`workbench.panels.locations.${location}`);

  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (session?.detachTimer !== undefined) window.clearTimeout(session.detachTimer);
    },
    [],
  );

  const clearDetachTimer = (session: ResizeSession) => {
    if (session.detachTimer === undefined) return;
    window.clearTimeout(session.detachTimer);
    session.detachTimer = undefined;
  };

  const scheduleDetachCompletion = (session: ResizeSession) => {
    clearDetachTimer(session);
    session.detachTimer = window.setTimeout(() => {
      if (sessionRef.current !== session || session.isSnapped) return;

      session.detachTimer = undefined;
      session.isDetaching = false;
      onResizingChange?.(true);
      onResize(session.latestSize);
    }, DETACH_ANIMATION_MS);
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    clearDetachTimer(session);
    onResizingChange?.(false);
    onResizeSessionChange?.(false);
    if (cancelled) {
      onResize(session.startSize);
      onExpand?.();
    } else if (!session.isSnapped) {
      onResize(session.latestSize);
    }

    sessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("workbench.panels.resize", { location: locationLabel })}
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(size)}
      aria-valuemin={Math.round(minSize)}
      aria-valuemax={maxSize === undefined ? undefined : Math.round(maxSize)}
      data-slot="workbench-panel-resize-handle"
      data-location={location}
      className={cn(
        "group absolute z-30 touch-none outline-none after:absolute after:bg-transparent after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring",
        location === "left" &&
          "inset-y-0 -right-1 w-2 cursor-col-resize after:inset-y-0 after:left-1/2 after:w-px",
        location === "right" &&
          "inset-y-0 -left-1 w-2 cursor-col-resize after:inset-y-0 after:left-1/2 after:w-px",
        location === "bottom" &&
          "inset-x-0 -top-1 h-2 cursor-row-resize after:inset-x-0 after:top-1/2 after:h-px",
        className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;

        sessionRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startSize: size,
          snapThreshold: size / 2,
          isSnapped: false,
          isDetaching: false,
          latestSize: size,
        };
        onResizingChange?.(true);
        onResizeSessionChange?.(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const session = sessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;

        const nextSize = session.startSize + pointerDelta(location, session, event);
        session.latestSize = nextSize;
        const shouldSnap = collapsible && nextSize < session.snapThreshold;

        if (shouldSnap !== session.isSnapped) {
          session.isSnapped = shouldSnap;
          clearDetachTimer(session);
          onResizingChange?.(false);

          if (shouldSnap) {
            session.isDetaching = false;
            onCollapse?.();
            return;
          }

          session.isDetaching = true;
          onResize(nextSize);
          onExpand?.();
          scheduleDetachCompletion(session);
          return;
        }

        if (!shouldSnap) {
          if (session.isDetaching) {
            onResize(nextSize);
            scheduleDetachCompletion(session);
          } else {
            onResizingChange?.(true);
            onResize(nextSize);
          }
        }
      }}
      onPointerUp={endResize}
      onPointerCancel={(event) => endResize(event, true)}
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
