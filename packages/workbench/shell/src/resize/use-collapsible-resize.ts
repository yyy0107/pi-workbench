"use client";

import {
  useEffect,
  useRef,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
  type PointerEventHandler,
} from "react";

import { animateSpring, applyMagneticSnap, type SpringAnimation } from "./resize-spring";

const DEFAULT_COLLAPSE_RATIO = 0.5;
const MAX_COLLAPSE_DISTANCE = 120;
const DEFAULT_KEYBOARD_STEP = 16;
const DEFAULT_RELEASE_DISTANCE = 24;
const MAX_SPRING_VELOCITY = 2400;

type ResizeDirection = -1 | 1;

export interface CollapsibleResizePreview {
  layoutWidth: number;
  contentWidth: number;
  translateX: number;
}

interface ResizeSession {
  pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  rawWidth: number;
  currentWidth: number;
  lastX: number;
  lastTime: number;
  velocity: number;
  minimumWidth: number;
  maximumWidth: number;
  collapseThreshold: number;
  snapPoints: readonly number[];
  collapsed: boolean;
}

export interface UseCollapsibleResizeOptions {
  width: number;
  minimumWidth: number;
  direction: ResizeDirection;
  getMaximumWidth(): number;
  getRenderedWidth(): number;
  getSnapPoints?(maximumWidth: number): readonly number[];
  onPreview(width: number): void;
  onCommit(width: number): void;
  onOpenChange(open: boolean): void;
  onResizingChange(resizing: boolean): void;
  collapseRatio?: number;
  releaseDistance?: number;
  keyboardStep?: number;
}

export function resolveCollapsibleResizeThreshold(
  minimumWidth: number,
  // Wider panels should not need a longer push past their minimum than the sidebar.
  collapseRatio = Math.min(DEFAULT_COLLAPSE_RATIO, MAX_COLLAPSE_DISTANCE / minimumWidth),
): number {
  const minimum = Number.isFinite(minimumWidth) ? Math.max(0, minimumWidth) : 0;
  const ratio = Number.isFinite(collapseRatio)
    ? Math.min(1, Math.max(0, collapseRatio))
    : DEFAULT_COLLAPSE_RATIO;
  return minimum - minimum * ratio;
}

export function resolveCollapsibleResizePreview(
  width: number,
  minimumWidth: number,
  direction: ResizeDirection,
): CollapsibleResizePreview {
  const layoutWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const minimum = Number.isFinite(minimumWidth) ? Math.max(0, minimumWidth) : 0;
  const contentWidth = Math.max(layoutWidth, minimum);

  return {
    layoutWidth,
    contentWidth,
    translateX: (layoutWidth - contentWidth) * direction,
  };
}

export function useCollapsibleResize(options: UseCollapsibleResizeOptions): {
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sessionRef = useRef<ResizeSession | null>(null);
  const animationRef = useRef<SpringAnimation | null>(null);

  const clampPreviewWidth = (session: ResizeSession, width: number) =>
    Math.min(session.maximumWidth, Math.max(0, width));
  const clampExpandedWidth = (session: ResizeSession, width: number) =>
    Math.min(session.maximumWidth, Math.max(session.minimumWidth, width));
  const snapReleasedWidth = (session: ResizeSession, width: number) =>
    width <= session.minimumWidth ? width : applyMagneticSnap(width, session.snapPoints);

  const previewWidth = (session: ResizeSession, width: number, handle: HTMLDivElement) => {
    const renderedWidth = clampPreviewWidth(session, width);
    optionsRef.current.onPreview(renderedWidth);
    handle.setAttribute("aria-valuenow", String(Math.round(renderedWidth)));
  };

  const animatePreview = (
    session: ResizeSession,
    target: number,
    handle: HTMLDivElement,
    onComplete?: () => void,
  ) => {
    animationRef.current?.cancel();
    let completedSynchronously = false;
    const animation = animateSpring({
      from: session.currentWidth,
      to: target,
      velocity: Math.min(
        MAX_SPRING_VELOCITY,
        Math.max(-MAX_SPRING_VELOCITY, session.velocity * 1000),
      ),
      onUpdate: (width) => {
        const renderedWidth = clampPreviewWidth(session, width);
        session.currentWidth = renderedWidth;
        previewWidth(session, renderedWidth, handle);
      },
      onComplete: () => {
        completedSynchronously = true;
        animationRef.current = null;
        onComplete?.();
      },
    });
    animationRef.current = completedSynchronously ? null : animation;
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    session.maximumWidth = Math.max(0, optionsRef.current.getMaximumWidth());

    sessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (cancelled) {
      animationRef.current?.cancel();
      animationRef.current = null;
      const restoredWidth = clampExpandedWidth(session, session.startWidth);
      previewWidth(session, restoredWidth, event.currentTarget);
      optionsRef.current.onCommit(restoredWidth);
      optionsRef.current.onOpenChange(true);
      optionsRef.current.onResizingChange(false);
      return;
    }

    if (session.collapsed) {
      if (!animationRef.current) {
        optionsRef.current.onCommit(session.minimumWidth);
        optionsRef.current.onOpenChange(false);
        optionsRef.current.onResizingChange(false);
      }
      return;
    }

    animationRef.current?.cancel();
    animationRef.current = null;
    const committedWidth = clampExpandedWidth(
      session,
      snapReleasedWidth(session, session.rawWidth),
    );
    previewWidth(session, committedWidth, event.currentTarget);
    optionsRef.current.onCommit(committedWidth);
    optionsRef.current.onOpenChange(true);
    optionsRef.current.onResizingChange(false);
  };

  useEffect(
    () => () => {
      animationRef.current?.cancel();
      optionsRef.current.onResizingChange(false);
    },
    [],
  );

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0) return;

    const current = optionsRef.current;
    animationRef.current?.cancel();
    animationRef.current = null;
    const maximumWidth = Math.max(0, current.getMaximumWidth());
    const minimumWidth = Math.min(maximumWidth, Math.max(0, current.minimumWidth));
    const measuredWidth = current.getRenderedWidth();
    const startWidth = Math.min(
      maximumWidth,
      Math.max(minimumWidth, measuredWidth || current.width),
    );
    const snapPoints = Array.from(
      new Set(
        (current.getSnapPoints?.(maximumWidth) ?? []).map((point) =>
          Math.min(maximumWidth, Math.max(minimumWidth, point)),
        ),
      ),
    );
    const now = performance.now();
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      rawWidth: startWidth,
      currentWidth: startWidth,
      lastX: event.clientX,
      lastTime: now,
      velocity: 0,
      minimumWidth,
      maximumWidth,
      collapseThreshold: resolveCollapsibleResizeThreshold(minimumWidth, current.collapseRatio),
      snapPoints,
      collapsed: false,
    };
    current.onResizingChange(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const current = optionsRef.current;
    session.maximumWidth = Math.max(0, current.getMaximumWidth());
    const now = performance.now();
    const elapsed = now - session.lastTime;
    if (elapsed > 0) {
      session.velocity = (current.direction * (event.clientX - session.lastX)) / elapsed;
    }
    session.lastX = event.clientX;
    session.lastTime = now;

    const requestedWidth =
      session.startWidth + current.direction * (event.clientX - session.startX);
    const releaseDistance = current.releaseDistance ?? DEFAULT_RELEASE_DISTANCE;
    if (session.collapsed) {
      // Reopen at a fixed boundary; rebasing on each reversal accumulates pointer drift.
      if (requestedWidth < session.collapseThreshold + releaseDistance) return;

      session.collapsed = false;
      current.onOpenChange(true);
      const rawWidth = clampPreviewWidth(session, requestedWidth);
      session.rawWidth = rawWidth;
      animationRef.current?.cancel();
      animationRef.current = null;
      session.currentWidth = rawWidth;
      previewWidth(session, rawWidth, event.currentTarget);
      return;
    }

    if (requestedWidth < session.collapseThreshold) {
      session.collapsed = true;
      session.rawWidth = requestedWidth;
      animatePreview(session, 0, event.currentTarget, () => {
        if (!session.collapsed || sessionRef.current === session) return;
        optionsRef.current.onCommit(session.minimumWidth);
        optionsRef.current.onOpenChange(false);
        optionsRef.current.onResizingChange(false);
      });
      return;
    }

    // Pointer previews stay 1:1, including the approach to the collapse threshold.
    const rawWidth = clampPreviewWidth(session, requestedWidth);
    session.rawWidth = rawWidth;
    animationRef.current?.cancel();
    animationRef.current = null;
    session.currentWidth = rawWidth;
    previewWidth(session, rawWidth, event.currentTarget);
  };

  const onKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    const current = optionsRef.current;
    const step = current.keyboardStep ?? DEFAULT_KEYBOARD_STEP;
    const movement = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    if (movement === 0) return;

    const maximumWidth = Math.max(0, current.getMaximumWidth());
    const minimumWidth = Math.min(maximumWidth, Math.max(0, current.minimumWidth));
    const nextWidth = Math.min(
      maximumWidth,
      Math.max(minimumWidth, current.width + current.direction * movement),
    );
    current.onCommit(nextWidth);
    current.onOpenChange(true);
    event.preventDefault();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event) => finishResize(event, false),
    onPointerCancel: (event) => finishResize(event, true),
    onKeyDown,
  };
}
