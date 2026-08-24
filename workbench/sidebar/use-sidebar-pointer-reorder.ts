"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import type { SidebarDropPosition } from "./sidebar-reorder";

const SIDEBAR_DRAG_ACTIVATION_DISTANCE_PX = 5;
const SIDEBAR_DRAG_CLICK_SUPPRESSION_MS = 350;

interface SidebarPointerDragCandidate {
  readonly element: HTMLElement;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly itemId: string;
}

export interface SidebarDropTarget {
  readonly itemId: string;
  readonly position: SidebarDropPosition;
}

export function useSidebarPointerReorder({
  enabled,
  orderedIds,
  ignoreSelector,
  onMove,
}: {
  enabled: boolean;
  orderedIds: readonly string[];
  ignoreSelector?: string;
  onMove(sourceId: string, targetId: string, position: SidebarDropPosition): void;
}) {
  const [draggingId, setDraggingId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget>();
  const dragCandidateRef = useRef<SidebarPointerDragCandidate | undefined>(undefined);
  const draggingIdRef = useRef<string | undefined>(undefined);
  const dropTargetRef = useRef<SidebarDropTarget | undefined>(undefined);
  const itemElementsRef = useRef(new Map<string, HTMLElement>());
  const orderedIdsRef = useRef(orderedIds);
  const onMoveRef = useRef(onMove);
  const suppressedClickRef = useRef<{ itemId: string; until: number } | undefined>(undefined);
  orderedIdsRef.current = orderedIds;
  onMoveRef.current = onMove;

  useEffect(() => {
    const finishDragging = () => {
      const candidate = dragCandidateRef.current;
      if (candidate?.element.hasPointerCapture(candidate.pointerId)) {
        candidate.element.releasePointerCapture(candidate.pointerId);
      }
      dragCandidateRef.current = undefined;
      draggingIdRef.current = undefined;
      dropTargetRef.current = undefined;
      setDraggingId(undefined);
      setDropTarget(undefined);
    };
    const updateDropTargetAt = (clientY: number): SidebarDropTarget | undefined => {
      const sourceId = draggingIdRef.current;
      if (!sourceId) return undefined;

      const rows = orderedIdsRef.current.flatMap((itemId) => {
        const element = itemElementsRef.current.get(itemId);
        if (!element || itemId === sourceId) return [];
        const bounds = element.getBoundingClientRect();
        return bounds.height > 0 ? [{ itemId, bounds }] : [];
      });
      if (rows.length === 0) {
        dropTargetRef.current = undefined;
        setDropTarget(undefined);
        return undefined;
      }

      const row =
        rows.find(({ bounds }) => clientY >= bounds.top && clientY <= bounds.bottom) ??
        rows.reduce((nearest, candidate) =>
          Math.abs(clientY - (candidate.bounds.top + candidate.bounds.height / 2)) <
          Math.abs(clientY - (nearest.bounds.top + nearest.bounds.height / 2))
            ? candidate
            : nearest,
        );
      const position: SidebarDropPosition =
        clientY < row.bounds.top + row.bounds.height / 2 ? "before" : "after";
      const currentTarget = dropTargetRef.current;
      if (currentTarget?.itemId === row.itemId && currentTarget.position === position) {
        return currentTarget;
      }

      const nextTarget = { itemId: row.itemId, position } as const;
      dropTargetRef.current = nextTarget;
      setDropTarget(nextTarget);
      return nextTarget;
    };
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const candidate = dragCandidateRef.current;
      if (!candidate || candidate.pointerId !== event.pointerId) return;
      if ((event.buttons & 1) === 0) {
        finishDragging();
        return;
      }

      if (!draggingIdRef.current) {
        const distance = Math.hypot(
          event.clientX - candidate.startX,
          event.clientY - candidate.startY,
        );
        if (distance < SIDEBAR_DRAG_ACTIVATION_DISTANCE_PX) return;
        candidate.element.setPointerCapture(candidate.pointerId);
        draggingIdRef.current = candidate.itemId;
        setDraggingId(candidate.itemId);
      }

      if (event.cancelable) event.preventDefault();
      window.getSelection()?.removeAllRanges();
      updateDropTargetAt(event.clientY);
    };
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const candidate = dragCandidateRef.current;
      if (!candidate || candidate.pointerId !== event.pointerId) return;
      const sourceId = draggingIdRef.current;
      if (sourceId === candidate.itemId) {
        if (event.cancelable) event.preventDefault();
        const target = updateDropTargetAt(event.clientY);
        if (target) onMoveRef.current(sourceId, target.itemId, target.position);
        suppressedClickRef.current = {
          itemId: candidate.itemId,
          until: performance.now() + SIDEBAR_DRAG_CLICK_SUPPRESSION_MS,
        };
      }
      finishDragging();
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      if (dragCandidateRef.current?.pointerId !== event.pointerId) return;
      finishDragging();
    };
    const handleWindowBlur = () => finishDragging();

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      const candidate = dragCandidateRef.current;
      if (candidate?.element.hasPointerCapture(candidate.pointerId)) {
        candidate.element.releasePointerCapture(candidate.pointerId);
      }
      dragCandidateRef.current = undefined;
      draggingIdRef.current = undefined;
      dropTargetRef.current = undefined;
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  const prepareDragging = (itemId: string, event: PointerEvent<HTMLElement>) => {
    if (
      !enabled ||
      !event.isPrimary ||
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      (ignoreSelector &&
        event.target instanceof Element &&
        event.target.closest(ignoreSelector) !== null)
    ) {
      return;
    }

    dragCandidateRef.current = {
      element: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      itemId,
    };
  };

  const registerItem = (itemId: string, element: HTMLElement | null) => {
    if (element) itemElementsRef.current.set(itemId, element);
    else itemElementsRef.current.delete(itemId);
  };

  const shouldSuppressClick = (itemId: string) => {
    const suppressedClick = suppressedClickRef.current;
    if (!suppressedClick || suppressedClick.itemId !== itemId) return false;
    if (performance.now() <= suppressedClick.until) return true;
    suppressedClickRef.current = undefined;
    return false;
  };

  return { draggingId, dropTarget, prepareDragging, registerItem, shouldSuppressClick };
}
