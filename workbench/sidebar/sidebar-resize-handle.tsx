"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import { animateSpring, applyMagneticSnap, type SpringAnimation } from "@/lib/resize-spring";

const KEYBOARD_STEP = 16;
const NORMAL_SIDEBAR_WIDTH = 268;
const WIDE_SIDEBAR_WIDTH = 420;
const COLLAPSE_TRIGGER_RATIO = 0.6;
const SNAP_RELEASE_DISTANCE = 24;

interface ResizeSession {
  pointerId: number;
  startX: number;
  startWidth: number;
  rawWidth: number;
  currentWidth: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  collapseThreshold: number;
  collapsed: boolean;
}

export interface SidebarResizeHandleProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  shellRef: RefObject<HTMLElement | null>;
  onResize(width: number): void;
}

export function SidebarResizeHandle({
  width,
  minWidth,
  maxWidth,
  shellRef,
  onResize,
}: SidebarResizeHandleProps) {
  const { t } = useI18n();
  const { setOpen } = useSidebar();
  const sessionRef = useRef<ResizeSession | null>(null);
  const animationRef = useRef<SpringAnimation | null>(null);

  const maximum = () => Math.min(maxWidth, Math.floor(window.innerWidth / 2));
  const clampDragWidth = (nextWidth: number) => Math.min(Math.max(nextWidth, 0), maximum());
  const clampExpandedWidth = (nextWidth: number) =>
    Math.min(Math.max(nextWidth, minWidth), maximum());

  const snapPoints = () => {
    const normal = clampExpandedWidth(NORMAL_SIDEBAR_WIDTH);
    const wide = clampExpandedWidth(WIDE_SIDEBAR_WIDTH);
    return wide - normal >= 48 ? [0, normal, wide] : [0, normal];
  };

  const previewWidth = (nextWidth: number, handle?: HTMLDivElement) => {
    const renderedWidth = clampDragWidth(nextWidth);
    shellRef.current?.style.setProperty("--sidebar-width", `${renderedWidth}px`);
    handle?.setAttribute("aria-valuenow", String(Math.round(renderedWidth)));
  };

  const setResizing = (resizing: boolean) => {
    if (resizing) shellRef.current?.setAttribute("data-resizing", "true");
    else shellRef.current?.removeAttribute("data-resizing");
  };

  const animatePreview = (session: ResizeSession, target: number, handle: HTMLDivElement) => {
    animationRef.current?.cancel();
    let completedSynchronously = false;
    const animation = animateSpring({
      from: session.currentWidth,
      to: target,
      velocity: session.velocity * 1000,
      onUpdate: (nextWidth) => {
        const renderedWidth = clampDragWidth(nextWidth);
        session.currentWidth = renderedWidth;
        previewWidth(renderedWidth, handle);
      },
      onComplete: () => {
        completedSynchronously = true;
        animationRef.current = null;
      },
    });
    animationRef.current = completedSynchronously ? null : animation;
  };

  useEffect(
    () => () => {
      animationRef.current?.cancel();
      shellRef.current?.removeAttribute("data-resizing");
    },
    [shellRef],
  );

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    sessionRef.current = null;
    const handle = event.currentTarget;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    animationRef.current?.cancel();
    animationRef.current = null;

    if (!cancelled && !session.collapsed) {
      const committedWidth = clampExpandedWidth(applyMagneticSnap(session.rawWidth, snapPoints()));
      previewWidth(committedWidth, handle);
      onResize(committedWidth);
      setOpen(true);
      setResizing(false);
      return;
    }

    const releaseVelocity = cancelled
      ? 0
      : session.velocity * Math.max(0, 1 - (performance.now() - session.lastTime) / 80);
    const target = cancelled ? session.startWidth : 0;
    let completedSynchronously = false;
    const animation = animateSpring({
      from: session.currentWidth,
      to: target,
      velocity: releaseVelocity * 1000,
      onUpdate: (nextWidth) => previewWidth(nextWidth, handle),
      onComplete: () => {
        completedSynchronously = true;
        animationRef.current = null;

        if (target === 0) {
          const restoredWidth = clampExpandedWidth(session.startWidth);
          onResize(restoredWidth);
          setOpen(false);
          window.requestAnimationFrame(() => {
            previewWidth(restoredWidth, handle);
            setResizing(false);
          });
          return;
        }

        const committedWidth = clampExpandedWidth(target);
        previewWidth(committedWidth, handle);
        onResize(committedWidth);
        setOpen(true);
        setResizing(false);
      },
    });
    animationRef.current = completedSynchronously ? null : animation;
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
      className="group absolute inset-y-0 -right-[5px] z-30 w-[10px] touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring"
      onPointerDown={(event) => {
        if (event.button !== 0) return;

        animationRef.current?.cancel();
        animationRef.current = null;
        const renderedWidth = shellRef.current
          ? Number.parseFloat(
              window.getComputedStyle(shellRef.current).getPropertyValue("--sidebar-width"),
            ) || width
          : width;
        const now = performance.now();
        sessionRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: renderedWidth,
          rawWidth: renderedWidth,
          currentWidth: renderedWidth,
          lastX: event.clientX,
          lastTime: now,
          velocity: 0,
          collapseThreshold: renderedWidth * COLLAPSE_TRIGGER_RATIO,
          collapsed: false,
        };
        setResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const session = sessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;

        const now = performance.now();
        const elapsed = now - session.lastTime;
        if (elapsed > 0) {
          session.velocity = (event.clientX - session.lastX) / elapsed;
        }
        session.lastX = event.clientX;
        session.lastTime = now;

        const rawWidth = clampDragWidth(session.startWidth + event.clientX - session.startX);
        session.rawWidth = rawWidth;
        if (session.collapsed) {
          if (rawWidth <= session.collapseThreshold + SNAP_RELEASE_DISTANCE) return;

          session.collapsed = false;
          animatePreview(session, applyMagneticSnap(rawWidth, snapPoints()), event.currentTarget);
          return;
        }

        if (rawWidth < session.collapseThreshold) {
          session.collapsed = true;
          animatePreview(session, 0, event.currentTarget);
          return;
        }

        const nextWidth = applyMagneticSnap(rawWidth, snapPoints());
        if (animationRef.current) {
          animationRef.current.setTarget(nextWidth);
        } else {
          session.currentWidth = nextWidth;
          previewWidth(nextWidth, event.currentTarget);
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
