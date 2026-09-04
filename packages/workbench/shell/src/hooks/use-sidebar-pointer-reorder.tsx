"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from "react";

import { useWorkbenchPortalContainer } from "../ui/workbench-portal-container";

export type SidebarDropPosition = "before" | "after" | "inside";
export interface SidebarDropTarget {
  id: string;
  position: SidebarDropPosition;
}
export interface SidebarDragBinding {
  enabled: boolean;
  dragging: boolean;
  dropPosition?: SidebarDropPosition;
  ref(element: HTMLElement | null): void;
  onPointerDown(event: PointerEvent<HTMLElement>): void;
  shouldSuppressClick(): boolean;
}
export interface SidebarPointerReorderOptions {
  id: string;
  enabled: boolean;
  resolveDrop(sourceId: string, edge: "before" | "after"): SidebarDropPosition | undefined;
  onDrop(sourceId: string, position: SidebarDropPosition): Promise<void>;
}
interface Registration {
  element: HTMLElement;
  options(): SidebarPointerReorderOptions;
}
interface DragSnapshot {
  draggingId?: string;
  dropTarget?: SidebarDropTarget;
  pending: boolean;
}
const EMPTY_SNAPSHOT: DragSnapshot = { pending: false };
const ACTIVATION_DISTANCE = 5;
const CLICK_SUPPRESSION_MS = 350;

/** A single pointer coordinator and persistence gate per installed sidebar. */
export function createSidebarDragSession() {
  const registrations = new Map<string, Registration>();
  const listeners = new Set<() => void>();
  let snapshot = EMPTY_SNAPSHOT;
  let clickDeadline = 0;
  let swallowClick = false;
  let candidate:
    | {
        id: string;
        element: HTMLElement;
        pointerId: number;
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
      }
    | undefined;
  let overlay: HTMLElement | undefined;
  let shield: HTMLElement | undefined;
  let scrollRoot: HTMLElement | null = null;
  let scrollFrame: number | undefined;
  let pointer = { x: 0, y: 0 };
  let portal: HTMLElement | undefined;
  const update = (patch: Partial<DragSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const isClickSuppressed = (now: number) => now <= clickDeadline;
  const suppressClicksUntil = (deadline: number) => {
    clickDeadline = deadline;
  };
  const suppressClick = () => {
    clickDeadline = performance.now() + CLICK_SUPPRESSION_MS;
    swallowClick = true;
  };
  const finish = () => {
    if (candidate?.element.hasPointerCapture(candidate.pointerId)) {
      candidate.element.releasePointerCapture(candidate.pointerId);
    }
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    overlay?.remove();
    shield?.remove();
    overlay = undefined;
    shield = undefined;
    candidate = undefined;
    scrollRoot = null;
    if (snapshot.draggingId || snapshot.dropTarget) {
      update({ draggingId: undefined, dropTarget: undefined });
    }
  };
  const cancel = () => {
    if (snapshot.draggingId) suppressClick();
    finish();
  };
  const targetAt = (x: number, y: number): SidebarDropTarget | undefined => {
    if (!snapshot.draggingId) return undefined;
    const viewport = scrollRoot?.getBoundingClientRect();
    if (
      viewport &&
      (x < viewport.left || x > viewport.right || y < viewport.top || y > viewport.bottom)
    )
      return undefined;
    for (const [id, registration] of registrations) {
      const bounds = registration.element.getBoundingClientRect();
      if (
        bounds.height <= 0 ||
        x < bounds.left ||
        x > bounds.right ||
        y < bounds.top - 1 ||
        y > bounds.bottom + 1
      )
        continue;
      if (id === snapshot.draggingId) return undefined;
      const edge = y < bounds.top + bounds.height / 2 ? "before" : "after";
      const position = registration.options().resolveDrop(snapshot.draggingId, edge);
      return position ? { id, position } : undefined;
    }
    return undefined;
  };
  const updateTarget = () => {
    const next = targetAt(pointer.x, pointer.y);
    if (next?.id !== snapshot.dropTarget?.id || next?.position !== snapshot.dropTarget?.position) {
      update({ dropTarget: next });
    }
    if (shield) shield.style.cursor = next ? "grabbing" : "not-allowed";
    return next;
  };
  const autoScroll = () => {
    if (!candidate || !snapshot.draggingId) return;
    if (scrollRoot) {
      const bounds = scrollRoot.getBoundingClientRect();
      if (pointer.x >= bounds.left && pointer.x <= bounds.right) {
        const edge = 36;
        const speed =
          pointer.y < bounds.top + edge
            ? -Math.min(14, (bounds.top + edge - pointer.y) / 3)
            : pointer.y > bounds.bottom - edge
              ? Math.min(14, (pointer.y - bounds.bottom + edge) / 3)
              : 0;
        if (speed) {
          scrollRoot.scrollTop += speed;
          updateTarget();
        }
      }
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  };
  const positionOverlay = () => {
    if (!candidate || !overlay) return;
    overlay.style.transform = `translate3d(${pointer.x - candidate.offsetX}px, ${pointer.y - candidate.offsetY}px, 0) scale(0.98)`;
  };
  const startOverlay = () => {
    if (!candidate) return;
    const bounds = candidate.element.getBoundingClientRect();
    overlay = candidate.element.cloneNode(true) as HTMLElement;
    overlay.removeAttribute("id");
    overlay.removeAttribute("data-sidebar-drop");
    for (const element of overlay.querySelectorAll("[id]")) element.removeAttribute("id");
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("data-sidebar-drag-overlay", "true");
    overlay.inert = true;
    Object.assign(overlay.style, {
      background: "var(--sidebar-accent)",
      boxShadow: "0 8px 24px color-mix(in srgb, var(--foreground) 20%, transparent)",
      color: "var(--sidebar-accent-foreground)",
      contain: "layout paint style",
      height: `${bounds.height}px`,
      width: `${bounds.width}px`,
      inset: "0 auto auto 0",
      margin: "0",
      opacity: "0.9",
      pointerEvents: "none",
      position: "fixed",
      overflow: "hidden",
      transformOrigin: `${candidate.offsetX}px ${candidate.offsetY}px`,
      transition: "none",
      userSelect: "none",
      willChange: "transform",
      zIndex: "2147483647",
    });
    shield = document.createElement("div");
    shield.setAttribute("aria-hidden", "true");
    shield.setAttribute("data-sidebar-drag-shield", "true");
    Object.assign(shield.style, {
      cursor: "grabbing",
      inset: "0",
      position: "fixed",
      zIndex: "2147483646",
    });
    (portal ?? document.body).append(shield, overlay);
    scrollRoot = candidate.element.closest<HTMLElement>("[data-workspace-scroll-container]");
    positionOverlay();
    scrollFrame = requestAnimationFrame(autoScroll);
  };
  const run = async (operation: () => Promise<void>) => {
    // ponytail: serialize one sidebar's moves; split by scope if concurrent moves become useful.
    if (snapshot.pending) return;
    update({ pending: true });
    try {
      await operation();
    } finally {
      update({ pending: false });
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isClickSuppressed,
    suppressClicksUntil,
    cancel,
    run,
    register(id: string, registration: Registration | undefined) {
      if (registration) registrations.set(id, registration);
      else {
        registrations.delete(id);
        if (candidate?.id === id) cancel();
      }
    },
    prepare(id: string, event: PointerEvent<HTMLElement>) {
      if (
        snapshot.pending ||
        !registrations.get(id)?.options().enabled ||
        !event.isPrimary ||
        event.pointerType !== "mouse" ||
        event.button !== 0
      )
        return;
      if (event.target instanceof Element && event.target.closest("[data-sidebar-actions]")) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      candidate = {
        id,
        element: event.currentTarget,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
      };
    },
    attach(container?: HTMLElement | null) {
      portal = container ?? undefined;
      const pointerMove = (event: globalThis.PointerEvent) => {
        if (!candidate || event.pointerId !== candidate.pointerId) return;
        if (!(event.buttons & 1) || !registrations.get(candidate.id)?.options().enabled) {
          cancel();
          return;
        }
        pointer = { x: event.clientX, y: event.clientY };
        if (!snapshot.draggingId) {
          if (
            Math.hypot(pointer.x - candidate.startX, pointer.y - candidate.startY) <
            ACTIVATION_DISTANCE
          )
            return;
          candidate.element.setPointerCapture(candidate.pointerId);
          update({ draggingId: candidate.id });
          startOverlay();
        }
        if (event.cancelable) event.preventDefault();
        window.getSelection()?.removeAllRanges();
        positionOverlay();
        updateTarget();
      };
      const pointerUp = (event: globalThis.PointerEvent) => {
        if (!candidate || event.pointerId !== candidate.pointerId) return;
        const sourceId = snapshot.draggingId;
        if (!sourceId) {
          finish();
          return;
        }
        pointer = { x: event.clientX, y: event.clientY };
        const target = updateTarget();
        const registration = target && registrations.get(target.id);
        const enabled = registrations.get(sourceId)?.options().enabled;
        if (event.cancelable) event.preventDefault();
        suppressClick();
        finish();
        if (target && registration && enabled) {
          void run(() => registration.options().onDrop(sourceId, target.position)).catch((error) =>
            console.error("[workbench] failed to move sidebar item", error),
          );
        }
      };
      const pointerCancel = (event: globalThis.PointerEvent) => {
        if (candidate?.pointerId === event.pointerId) cancel();
      };
      const keyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && candidate) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      };
      const click = (event: MouseEvent) => {
        if (!swallowClick) return;
        swallowClick = false;
        if (!isClickSuppressed(performance.now())) return;
        event.preventDefault();
        event.stopPropagation();
      };
      window.addEventListener("pointermove", pointerMove, { capture: true, passive: false });
      window.addEventListener("pointerup", pointerUp, true);
      window.addEventListener("pointercancel", pointerCancel, true);
      window.addEventListener("keydown", keyDown, true);
      window.addEventListener("click", click, true);
      window.addEventListener("blur", cancel);
      return () => {
        cancel();
        window.removeEventListener("pointermove", pointerMove, true);
        window.removeEventListener("pointerup", pointerUp, true);
        window.removeEventListener("pointercancel", pointerCancel, true);
        window.removeEventListener("keydown", keyDown, true);
        window.removeEventListener("click", click, true);
        window.removeEventListener("blur", cancel);
      };
    },
  };
}

const SidebarDragContext = createContext<ReturnType<typeof createSidebarDragSession> | null>(null);

export function SidebarDragSessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createSidebarDragSession);
  const portal = useWorkbenchPortalContainer();
  useEffect(() => session.attach(portal?.current), [portal, session]);
  return <SidebarDragContext.Provider value={session}>{children}</SidebarDragContext.Provider>;
}

export function useSidebarDragSession() {
  const session = useContext(SidebarDragContext);
  if (!session) throw new Error("Sidebar drag hooks require SidebarDragSessionProvider");
  return session;
}

export function useSidebarDragState() {
  const session = useSidebarDragSession();
  return useSyncExternalStore(session.subscribe, session.getSnapshot, () => EMPTY_SNAPSHOT);
}

/** Registers a row or a non-draggable group heading with the shared pointer coordinator. */
export function useSidebarPointerReorder(
  options: SidebarPointerReorderOptions,
): SidebarDragBinding {
  const session = useSidebarDragSession();
  const state = useSidebarDragState();
  const latest = useRef(options);
  latest.current = options;
  const ref = useCallback(
    (element: HTMLElement | null) => {
      session.register(
        options.id,
        element ? { element, options: () => latest.current } : undefined,
      );
    },
    [options.id, session],
  );
  return {
    ref,
    enabled: options.enabled && !state.pending,
    dragging: state.draggingId === options.id,
    dropPosition: state.dropTarget?.id === options.id ? state.dropTarget.position : undefined,
    onPointerDown: (event) => session.prepare(options.id, event),
    shouldSuppressClick: () => session.isClickSuppressed(performance.now()),
  };
}
