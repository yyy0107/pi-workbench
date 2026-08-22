"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { useI18n } from "@/i18n";
import { animateSpring, applyMagneticSnap, type SpringAnimation } from "@/lib/resize-spring";

import { DEFAULT_RIGHT_WORKSPACE_WIDTH, MIN_RIGHT_WORKSPACE_WIDTH } from "./core/workspace-store";
import { useRightWorkspace } from "./workspace-context";

const KEYBOARD_STEP = 16;
const WIDE_RIGHT_WORKSPACE_WIDTH = 720;
const COLLAPSE_TRIGGER_RATIO = 0.6;
const SNAP_RELEASE_DISTANCE = 24;

interface ResizeSession {
  pointerId: number;
  x: number;
  width: number;
  rawWidth: number;
  currentWidth: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  collapseThreshold: number;
  collapsed: boolean;
}

export function WorkspaceResizeHandle({
  width,
  maximum,
  workspaceRef,
}: Readonly<{
  width: number;
  maximum: number;
  workspaceRef: RefObject<HTMLElement | null>;
}>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const sessionRef = useRef<ResizeSession | undefined>(undefined);
  const animationRef = useRef<SpringAnimation | null>(null);

  const clampDragWidth = (nextWidth: number) => Math.min(maximum, Math.max(0, nextWidth));
  const clampExpandedWidth = (nextWidth: number) =>
    Math.min(maximum, Math.max(MIN_RIGHT_WORKSPACE_WIDTH, nextWidth));

  const snapPoints = () => {
    const normal = clampExpandedWidth(DEFAULT_RIGHT_WORKSPACE_WIDTH);
    const wide = clampExpandedWidth(WIDE_RIGHT_WORKSPACE_WIDTH);
    return wide - normal >= 64 ? [0, normal, wide] : [0, normal];
  };

  const previewWidth = (nextWidth: number, handle?: HTMLDivElement) => {
    const renderedWidth = clampDragWidth(nextWidth);
    workspaceRef.current?.style.setProperty("--right-workspace-width", `${renderedWidth}px`);
    handle?.setAttribute("aria-valuenow", String(Math.round(renderedWidth)));
  };

  const setResizing = (resizing: boolean) => {
    if (resizing) workspaceRef.current?.setAttribute("data-resizing", "true");
    else workspaceRef.current?.removeAttribute("data-resizing");
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
      workspaceRef.current?.removeAttribute("data-resizing");
    },
    [workspaceRef],
  );

  const finish = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    sessionRef.current = undefined;
    const handle = event.currentTarget;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    animationRef.current?.cancel();
    animationRef.current = null;

    if (!cancelled && !session.collapsed) {
      const committedWidth = clampExpandedWidth(applyMagneticSnap(session.rawWidth, snapPoints()));
      previewWidth(committedWidth, handle);
      controller.setWidth(committedWidth);
      setResizing(false);
      return;
    }

    const releaseVelocity = cancelled
      ? 0
      : session.velocity * Math.max(0, 1 - (performance.now() - session.lastTime) / 80);
    const target = cancelled ? session.width : 0;
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
          const restoredWidth = clampExpandedWidth(session.width);
          controller.setWidth(restoredWidth);
          controller.setWorkspaceOpen(false);
          window.requestAnimationFrame(() => {
            previewWidth(restoredWidth, handle);
            setResizing(false);
          });
          return;
        }

        const committedWidth = clampExpandedWidth(target);
        previewWidth(committedWidth, handle);
        controller.setWidth(committedWidth);
        setResizing(false);
      },
    });
    animationRef.current = completedSynchronously ? null : animation;
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("rightWorkspace.resize")}
      aria-orientation="vertical"
      aria-valuemin={MIN_RIGHT_WORKSPACE_WIDTH}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(width)}
      className="group absolute inset-y-0 -left-[5px] z-40 w-[10px] touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-ring focus-visible:after:bg-ring"
      onPointerDown={(event) => {
        if (event.button !== 0) return;

        animationRef.current?.cancel();
        animationRef.current = null;
        const renderedWidth = workspaceRef.current?.getBoundingClientRect().width || width;
        const now = performance.now();
        sessionRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          width: renderedWidth,
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
          session.velocity = (session.lastX - event.clientX) / elapsed;
        }
        session.lastX = event.clientX;
        session.lastTime = now;

        const rawWidth = clampDragWidth(session.width + session.x - event.clientX);
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
      onPointerUp={finish}
      onPointerCancel={(event) => finish(event, true)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          controller.setWidth(clampExpandedWidth(width + KEYBOARD_STEP));
        } else if (event.key === "ArrowRight") {
          controller.setWidth(clampExpandedWidth(width - KEYBOARD_STEP));
        } else return;
        event.preventDefault();
      }}
    />
  );
}
