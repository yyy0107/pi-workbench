"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";

const KEYBOARD_STEP = 16;
const DETACH_ANIMATION_MS = 300;

interface ResizeSession {
  pointerId: number;
  startX: number;
  startWidth: number;
  snapThreshold: number;
  isSnapped: boolean;
  isDetaching: boolean;
  latestWidth: number;
  detachTimer?: number;
}

function clearDetachTimer(session: ResizeSession) {
  if (session.detachTimer === undefined) return;

  window.clearTimeout(session.detachTimer);
  session.detachTimer = undefined;
}

export interface SidebarResizeHandleProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  onResize(width: number): void;
  onResizingChange(resizing: boolean): void;
}

export function SidebarResizeHandle({
  width,
  minWidth,
  maxWidth,
  onResize,
  onResizingChange,
}: SidebarResizeHandleProps) {
  const { t } = useI18n();
  const { setOpen } = useSidebar();
  const sessionRef = useRef<ResizeSession | null>(null);

  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (session) clearDetachTimer(session);
    },
    [],
  );

  const scheduleDetachCompletion = (session: ResizeSession) => {
    clearDetachTimer(session);
    session.detachTimer = window.setTimeout(() => {
      if (sessionRef.current !== session || session.isSnapped) return;

      session.detachTimer = undefined;
      session.isDetaching = false;
      onResizingChange(true);
      onResize(session.latestWidth);
    }, DETACH_ANIMATION_MS);
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    clearDetachTimer(session);
    onResizingChange(false);
    if (cancelled) {
      onResize(session.startWidth);
      setOpen(true);
    } else if (!session.isSnapped) {
      onResize(session.latestWidth);
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
      aria-label={t("workbench.sidebar.resize")}
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(minWidth)}
      aria-valuemax={Math.round(maxWidth)}
      data-slot="workbench-sidebar-resize-handle"
      className="group absolute inset-y-0 -right-1 z-30 w-2 touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring"
      onPointerDown={(event) => {
        if (event.button !== 0) return;

        sessionRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
          snapThreshold: width / 2,
          isSnapped: false,
          isDetaching: false,
          latestWidth: width,
        };
        onResizingChange(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const session = sessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;

        const nextWidth = session.startWidth + event.clientX - session.startX;
        session.latestWidth = nextWidth;
        const shouldSnap = nextWidth < session.snapThreshold;

        if (shouldSnap !== session.isSnapped) {
          session.isSnapped = shouldSnap;
          clearDetachTimer(session);
          onResizingChange(false);

          if (shouldSnap) {
            session.isDetaching = false;
            setOpen(false);
            return;
          }

          session.isDetaching = true;
          onResize(nextWidth);
          setOpen(true);
          scheduleDetachCompletion(session);
          return;
        }

        if (!shouldSnap) {
          if (session.isDetaching) {
            onResize(nextWidth);
            scheduleDetachCompletion(session);
          } else {
            onResizingChange(true);
            onResize(nextWidth);
          }
        }
      }}
      onPointerUp={(event) => finishResize(event)}
      onPointerCancel={(event) => finishResize(event, true)}
      onKeyDown={(event) => {
        let nextWidth = width;
        if (event.key === "ArrowLeft") nextWidth -= KEYBOARD_STEP;
        if (event.key === "ArrowRight") nextWidth += KEYBOARD_STEP;
        if (nextWidth === width) return;

        event.preventDefault();
        setOpen(true);
        onResize(nextWidth);
      }}
    />
  );
}
