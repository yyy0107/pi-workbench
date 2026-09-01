"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

import type { SidebarDropPosition } from "./sidebar-reorder";
import { useSidebarDragSession } from "./sidebar-drag-session";

const SIDEBAR_DRAG_ACTIVATION_DISTANCE_PX = 5;
const SIDEBAR_DRAG_CLICK_SUPPRESSION_MS = 350;
const SIDEBAR_DRAG_OVERLAY_SCALE = 0.98;

interface SidebarPointerDragCandidate {
  readonly element: HTMLElement;
  readonly grabOffsetX: number;
  readonly grabOffsetY: number;
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
  const dragSession = useSidebarDragSession();
  const [draggingId, setDraggingId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget>();
  const dragCandidateRef = useRef<SidebarPointerDragCandidate | undefined>(undefined);
  const draggingIdRef = useRef<string | undefined>(undefined);
  const dropTargetRef = useRef<SidebarDropTarget | undefined>(undefined);
  const dragOverlayRef = useRef<HTMLElement | undefined>(undefined);
  const dragShieldRef = useRef<HTMLElement | undefined>(undefined);
  const itemElementsRef = useRef(new Map<string, HTMLElement>());
  const orderedIdsRef = useRef(orderedIds);
  const onMoveRef = useRef(onMove);
  const suppressedClickRef = useRef<{ itemId: string; until: number } | undefined>(undefined);
  orderedIdsRef.current = orderedIds;
  onMoveRef.current = onMove;

  useEffect(() => {
    const clearDragOverlay = () => {
      dragOverlayRef.current?.remove();
      dragShieldRef.current?.remove();
      dragOverlayRef.current = undefined;
      dragShieldRef.current = undefined;
    };
    const positionDragOverlay = (clientX: number, clientY: number) => {
      const candidate = dragCandidateRef.current;
      const overlay = dragOverlayRef.current;
      if (!candidate || !overlay) return;

      overlay.style.transform = `translate3d(${clientX - candidate.grabOffsetX}px, ${clientY - candidate.grabOffsetY}px, 0) scale(${SIDEBAR_DRAG_OVERLAY_SCALE})`;
    };
    const createDragOverlay = (
      candidate: SidebarPointerDragCandidate,
      clientX: number,
      clientY: number,
    ) => {
      clearDragOverlay();
      const bounds = candidate.element.getBoundingClientRect();
      const overlay = candidate.element.cloneNode(true) as HTMLElement;
      const shield = document.createElement("div");

      overlay.removeAttribute("id");
      for (const element of overlay.querySelectorAll("[id]")) element.removeAttribute("id");
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("data-sidebar-drag-overlay", "true");
      overlay.inert = true;
      Object.assign(overlay.style, {
        background: "var(--sidebar-accent)",
        boxShadow:
          "0 16px 36px rgb(0 0 0 / 20%), 0 4px 12px rgb(0 0 0 / 12%), inset 0 0 0 1px var(--sidebar-border)",
        color: "var(--sidebar-accent-foreground)",
        contain: "layout paint style",
        cursor: "grabbing",
        height: `${bounds.height}px`,
        inset: "0 auto auto 0",
        margin: "0",
        opacity: "0.9",
        overflow: "hidden",
        pointerEvents: "none",
        position: "fixed",
        transformOrigin: `${candidate.grabOffsetX}px ${candidate.grabOffsetY}px`,
        transition: "none",
        userSelect: "none",
        width: `${bounds.width}px`,
        willChange: "transform",
        zIndex: "2147483647",
      });

      shield.setAttribute("aria-hidden", "true");
      shield.setAttribute("data-sidebar-drag-shield", "true");
      Object.assign(shield.style, {
        cursor: "grabbing",
        inset: "0",
        position: "fixed",
        zIndex: "2147483646",
      });

      document.body.append(shield, overlay);
      dragOverlayRef.current = overlay;
      dragShieldRef.current = shield;
      positionDragOverlay(clientX, clientY);
    };
    const finishDragging = () => {
      const candidate = dragCandidateRef.current;
      if (candidate?.element.hasPointerCapture(candidate.pointerId)) {
        candidate.element.releasePointerCapture(candidate.pointerId);
      }
      clearDragOverlay();
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
        createDragOverlay(candidate, event.clientX, event.clientY);
      }

      if (event.cancelable) event.preventDefault();
      window.getSelection()?.removeAllRanges();
      positionDragOverlay(event.clientX, event.clientY);
      updateDropTargetAt(event.clientY);
    };
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const candidate = dragCandidateRef.current;
      if (!candidate || candidate.pointerId !== event.pointerId) return;
      const sourceId = draggingIdRef.current;
      if (sourceId === candidate.itemId) {
        if (event.cancelable) event.preventDefault();
        const suppressionUntil = performance.now() + SIDEBAR_DRAG_CLICK_SUPPRESSION_MS;
        dragSession.suppressClicksUntil(suppressionUntil);
        suppressedClickRef.current = {
          itemId: candidate.itemId,
          until: suppressionUntil,
        };
        const target = updateDropTargetAt(event.clientY);
        if (target) onMoveRef.current(sourceId, target.itemId, target.position);
      }
      finishDragging();
    };
    const handleClick = (event: MouseEvent) => {
      const suppressedClick = suppressedClickRef.current;
      if (!suppressedClick) return;
      suppressedClickRef.current = undefined;
      if (performance.now() > suppressedClick.until) return;

      // Pointer capture and the reorder layout update can retarget the click generated after
      // pointerup to another row. Stop that one click before any sidebar trigger receives it.
      event.preventDefault();
      event.stopPropagation();
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      if (dragCandidateRef.current?.pointerId !== event.pointerId) return;
      finishDragging();
    };
    const handleWindowBlur = () => finishDragging();

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("click", handleClick, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      const candidate = dragCandidateRef.current;
      if (candidate?.element.hasPointerCapture(candidate.pointerId)) {
        candidate.element.releasePointerCapture(candidate.pointerId);
      }
      dragCandidateRef.current = undefined;
      draggingIdRef.current = undefined;
      dropTargetRef.current = undefined;
      clearDragOverlay();
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [dragSession]);

  const prepareDragging = useCallback(
    (itemId: string, event: PointerEvent<HTMLElement>) => {
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

      const bounds = event.currentTarget.getBoundingClientRect();
      dragCandidateRef.current = {
        element: event.currentTarget,
        grabOffsetX: event.clientX - bounds.left,
        grabOffsetY: event.clientY - bounds.top,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        itemId,
      };
    },
    [enabled, ignoreSelector],
  );

  const registerItem = useCallback((itemId: string, element: HTMLElement | null) => {
    if (element) itemElementsRef.current.set(itemId, element);
    else itemElementsRef.current.delete(itemId);
  }, []);

  const shouldSuppressClick = useCallback(
    (itemId: string) => {
      const now = performance.now();
      if (dragSession.isClickSuppressed(now)) return true;

      const suppressedClick = suppressedClickRef.current;
      if (!suppressedClick || suppressedClick.itemId !== itemId) return false;
      if (now <= suppressedClick.until) return true;
      suppressedClickRef.current = undefined;
      return false;
    },
    [dragSession],
  );

  return { draggingId, dropTarget, prepareDragging, registerItem, shouldSuppressClick };
}
