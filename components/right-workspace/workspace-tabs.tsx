"use client";

import { PanelsTopLeftIcon, PinIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

import { selectActiveSurface, selectContextSurfacesByPlacement } from "./core/workspace-selectors";
import {
  useRightWorkspace,
  useRightWorkspaceEnvironment,
  useRightWorkspaceState,
  useWorkspaceContext,
  useWorkspaceSurfaceDefinitions,
} from "./workspace-context";
import { nextWorkspaceTabIndex, workspaceTabId, workspaceTabPanelId } from "./workspace-tab-a11y";
import { workspaceTabScrollDelta } from "./workspace-tab-layout";

type DropPosition = "before" | "after";
type TabLayout = {
  left: number;
  width: number;
};
type PointerDragCandidate = {
  grabOffsetX: number;
  grabOffsetY: number;
  height: number;
  lastClientX: number;
  lastClientY: number;
  pointerId: number;
  startX: number;
  startY: number;
  surfaceId: string;
  width: number;
};
type PendingSurfaceClose = {
  closedSurfaceIds: readonly string[];
  close: () => void;
  holdWidthsForPointer: boolean;
};

const TAB_LAYOUT_ANIMATION_DURATION_MS = 180;
const TAB_DRAG_ACTIVATION_DISTANCE_PX = 5;
const TAB_DRAG_CLICK_SUPPRESSION_MS = 400;
const TAB_AUTO_SCROLL_EDGE_PX = 48;
const TAB_AUTO_SCROLL_MAX_SPEED_PX = 10;
const TAB_AUTO_SCROLL_VERTICAL_TOLERANCE_PX = 24;
const WHEEL_LINE_HEIGHT_PX = 16;

function wheelDeltaInPixels(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize;
  return delta;
}

function tabAutoScrollVelocity(clientX: number, bounds: DOMRect): number {
  const leftEdgeDistance = bounds.left + TAB_AUTO_SCROLL_EDGE_PX - clientX;
  if (leftEdgeDistance > 0) {
    const intensity = Math.min(1, leftEdgeDistance / TAB_AUTO_SCROLL_EDGE_PX);
    return -(1 + intensity * (TAB_AUTO_SCROLL_MAX_SPEED_PX - 1));
  }

  const rightEdgeDistance = clientX - (bounds.right - TAB_AUTO_SCROLL_EDGE_PX);
  if (rightEdgeDistance > 0) {
    const intensity = Math.min(1, rightEdgeDistance / TAB_AUTO_SCROLL_EDGE_PX);
    return 1 + intensity * (TAB_AUTO_SCROLL_MAX_SPEED_PX - 1);
  }

  return 0;
}

function horizontalLayoutBounds(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  const transform = getComputedStyle(element).transform;
  if (transform === "none") {
    return { left: bounds.left, right: bounds.right, width: bounds.width };
  }

  try {
    const matrix = new DOMMatrixReadOnly(transform);
    return {
      left: bounds.left - matrix.m41,
      right: bounds.right - matrix.m41,
      width: bounds.width,
    };
  } catch {
    return { left: bounds.left, right: bounds.right, width: bounds.width };
  }
}

function horizontalDropPosition(clientX: number, element: HTMLElement): DropPosition {
  const bounds = horizontalLayoutBounds(element);
  const beforeMidpoint = clientX < bounds.left + bounds.width / 2;
  return getComputedStyle(element).direction === "rtl"
    ? beforeMidpoint
      ? "after"
      : "before"
    : beforeMidpoint
      ? "before"
      : "after";
}

export function WorkspaceTabs() {
  const { t, text } = useI18n();
  const reduceMotion = useReducedMotion();
  const controller = useRightWorkspace();
  const environment = useRightWorkspaceEnvironment();
  const context = useWorkspaceContext();
  const surfaceOrder = useRightWorkspaceState((state) => state.surfaceOrder);
  const surfacesById = useRightWorkspaceState((state) => state.surfaces);
  const activeSurfaceId = useRightWorkspaceState(
    (state) => selectActiveSurface(state, context)?.id ?? null,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingSurfaceClose>();
  const draggingIdRef = useRef<string | null>(null);
  const pointerDragCandidate = useRef<PointerDragCandidate | null>(null);
  const suppressedClick = useRef<{ surfaceId: string; until: number } | null>(null);
  const dragOverlayElement = useRef<HTMLDivElement>(null);
  const tabListElement = useRef<HTMLDivElement>(null);
  const tabElements = useRef(new Map<string, HTMLDivElement>());
  const previousTabLayouts = useRef<Map<string, TabLayout> | null>(null);
  const tabAnimations = useRef(new Map<string, Animation>());
  const tabWidthAnimations = useRef(new Map<string, Animation>());
  const tabTrailingSpaceAnimation = useRef<Animation | null>(null);
  const tabWidthLockStartedAt = useRef<number | null>(null);
  const tabWidthReleaseTimer = useRef<number | null>(null);
  const definitions = useWorkspaceSurfaceDefinitions();
  const definitionByKind = useMemo(
    () => new Map(definitions.map((definition) => [definition.kind, definition])),
    [definitions],
  );
  const surfaces = useMemo(
    () =>
      selectContextSurfacesByPlacement(
        { ...environment.store.getState(), surfaceOrder, surfaces: surfacesById },
        context,
        "primary",
      ),
    [context, environment.store, surfaceOrder, surfacesById],
  );
  const focusTabAt = useCallback(
    (index: number) => {
      const surface = surfaces[index];
      if (!surface) return;
      controller.focus(surface.id);
      window.requestAnimationFrame(() => {
        tabElements.current
          .get(surface.id)
          ?.querySelector<HTMLButtonElement>('[role="tab"]')
          ?.focus();
      });
    },
    [controller, surfaces],
  );
  const captureTabLayouts = useCallback(() => {
    const layouts = new Map<string, TabLayout>();
    for (const [surfaceId, element] of tabElements.current) {
      const bounds = element.getBoundingClientRect();
      layouts.set(surfaceId, { left: bounds.left, width: bounds.width });
    }
    return layouts;
  }, []);
  const cancelTabAnimations = useCallback(() => {
    for (const animation of tabAnimations.current.values()) animation.cancel();
    tabAnimations.current.clear();
  }, []);
  const cancelTabWidthAnimations = useCallback(() => {
    for (const animation of tabWidthAnimations.current.values()) animation.cancel();
    tabWidthAnimations.current.clear();
    tabTrailingSpaceAnimation.current?.cancel();
    tabTrailingSpaceAnimation.current = null;
  }, []);
  const releaseTabWidths = useCallback(() => {
    if (tabWidthReleaseTimer.current !== null) {
      window.clearTimeout(tabWidthReleaseTimer.current);
      tabWidthReleaseTimer.current = null;
    }
    if (tabWidthLockStartedAt.current === null) return;
    tabWidthLockStartedAt.current = null;

    const currentLayouts = captureTabLayouts();
    if (currentLayouts.size === 0) return;

    const elements = [...tabElements.current.entries()];
    const list = tabListElement.current;
    const currentScrollLeft = list?.scrollLeft ?? 0;
    const currentTrailingSpace = list
      ? Number.parseFloat(getComputedStyle(list).paddingInlineEnd) || 0
      : 0;
    // Measure the unlocked flex layout without painting it, then restore the locked
    // geometry so every tab can animate to its final width without a visual jump.
    for (const [, element] of elements) {
      element.style.setProperty("transition-property", "none");
      element.style.removeProperty("flex");
    }
    list?.style.setProperty("transition-property", "none");
    list?.style.removeProperty("padding-inline-end");

    const targetWidths = new Map<string, number>();
    for (const [surfaceId, element] of elements) {
      targetWidths.set(surfaceId, element.getBoundingClientRect().width);
    }

    for (const [surfaceId, element] of elements) {
      const currentWidth = currentLayouts.get(surfaceId)?.width;
      if (currentWidth !== undefined) {
        element.style.setProperty("flex", `0 0 ${currentWidth}px`);
      }
    }
    if (list && currentTrailingSpace > 0) {
      list.style.setProperty("padding-inline-end", `${currentTrailingSpace}px`);
    }
    void list?.offsetWidth;
    if (list) list.scrollLeft = currentScrollLeft;
    for (const [, element] of elements) element.style.removeProperty("transition-property");
    list?.style.removeProperty("transition-property");

    if (reduceMotion) {
      for (const [, element] of elements) element.style.removeProperty("flex");
      list?.style.removeProperty("padding-inline-end");
      return;
    }

    for (const [surfaceId, element] of elements) {
      const currentWidth = currentLayouts.get(surfaceId)?.width;
      const targetWidth = targetWidths.get(surfaceId);
      if (
        currentWidth === undefined ||
        targetWidth === undefined ||
        Math.abs(currentWidth - targetWidth) < 0.5
      ) {
        element.style.removeProperty("flex");
        continue;
      }

      element.style.setProperty("flex", `0 0 ${targetWidth}px`);
      const animation = element.animate(
        [{ flexBasis: `${currentWidth}px` }, { flexBasis: `${targetWidth}px` }],
        {
          duration: TAB_LAYOUT_ANIMATION_DURATION_MS,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
      tabWidthAnimations.current.set(surfaceId, animation);
      animation.addEventListener("finish", () => {
        if (tabWidthAnimations.current.get(surfaceId) !== animation) return;
        tabWidthAnimations.current.delete(surfaceId);
        element.style.removeProperty("flex");
      });
    }

    if (list && currentTrailingSpace >= 0.5) {
      list.style.setProperty("padding-inline-end", "0px");
      const animation = list.animate(
        [{ paddingInlineEnd: `${currentTrailingSpace}px` }, { paddingInlineEnd: "0px" }],
        {
          duration: TAB_LAYOUT_ANIMATION_DURATION_MS,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
      tabTrailingSpaceAnimation.current = animation;
      animation.addEventListener("finish", () => {
        if (tabTrailingSpaceAnimation.current !== animation) return;
        tabTrailingSpaceAnimation.current = null;
        list.style.removeProperty("padding-inline-end");
      });
    } else {
      list?.style.removeProperty("padding-inline-end");
    }
  }, [captureTabLayouts, reduceMotion]);
  const scheduleTabWidthRelease = useCallback(() => {
    const startedAt = tabWidthLockStartedAt.current;
    if (startedAt === null) return;
    if (tabWidthReleaseTimer.current !== null) {
      window.clearTimeout(tabWidthReleaseTimer.current);
    }
    const remainingDelay = Math.max(
      0,
      TAB_LAYOUT_ANIMATION_DURATION_MS - (performance.now() - startedAt),
    );
    tabWidthReleaseTimer.current = window.setTimeout(releaseTabWidths, remainingDelay);
  }, [releaseTabWidths]);
  const closeWithTabAnimation = useCallback(
    (closedSurfaceIds: readonly string[], close: () => void, holdWidthsForPointer: boolean) => {
      if (tabWidthReleaseTimer.current !== null) {
        window.clearTimeout(tabWidthReleaseTimer.current);
        tabWidthReleaseTimer.current = null;
      }

      const layouts = captureTabLayouts();
      previousTabLayouts.current = layouts;
      for (const [surfaceId, layout] of layouts) {
        const element = tabElements.current.get(surfaceId);
        if (!element) continue;
        element.style.setProperty("transition-property", "none");
        element.style.setProperty("flex", `0 0 ${layout.width}px`);
      }
      const list = tabListElement.current;
      const hadScrollableOverflow = list ? list.scrollWidth - list.clientWidth >= 0.5 : false;
      if (list) {
        const currentTrailingSpace =
          Number.parseFloat(getComputedStyle(list).paddingInlineEnd) || 0;
        list.style.setProperty("padding-inline-end", `${currentTrailingSpace}px`);
      }
      cancelTabAnimations();
      cancelTabWidthAnimations();
      if (list && hadScrollableOverflow) {
        const closedLayouts = closedSurfaceIds.flatMap((surfaceId) => {
          const layout = layouts.get(surfaceId);
          return layout ? [layout] : [];
        });
        const remainingTabCount = layouts.size - closedLayouts.length;
        if (closedLayouts.length > 0 && remainingTabCount > 0) {
          const currentTrailingSpace = Number.parseFloat(list.style.paddingInlineEnd) || 0;
          const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
          const closedExtent = closedLayouts.reduce(
            (total, layout) => total + layout.width + gap,
            0,
          );
          // Preserve an existing scroll range while the pointer remains in the strip.
          // A fitting tab row must shrink immediately so adjacent controls follow it.
          list.style.setProperty("padding-inline-end", `${currentTrailingSpace + closedExtent}px`);
        }
      }
      tabWidthLockStartedAt.current = performance.now();

      close();
      if (!holdWidthsForPointer) scheduleTabWidthRelease();
    },
    [cancelTabAnimations, cancelTabWidthAnimations, captureTabLayouts, scheduleTabWidthRelease],
  );
  const requestCloseWithTabAnimation = useCallback(
    (closedSurfaceIds: readonly string[], close: () => void, holdWidthsForPointer: boolean) => {
      const dirtyCount = closedSurfaceIds.reduce(
        (count, surfaceId) => count + (surfacesById[surfaceId]?.dirty ? 1 : 0),
        0,
      );
      if (dirtyCount > 0) {
        // The close is deferred until the dialog action, so pointer-hover width
        // locking must not outlive the original tab interaction.
        setPendingClose({ closedSurfaceIds, close, holdWidthsForPointer: false });
        return;
      }
      closeWithTabAnimation(closedSurfaceIds, close, holdWidthsForPointer);
    },
    [closeWithTabAnimation, surfacesById],
  );
  const previewReorder = useCallback(
    (targetId: string, position: DropPosition) => {
      const currentDraggingId = draggingIdRef.current;
      if (!currentDraggingId || currentDraggingId === targetId) return;
      const draggingIndex = surfaces.findIndex((surface) => surface.id === currentDraggingId);
      const targetIndex = surfaces.findIndex((surface) => surface.id === targetId);
      if (draggingIndex < 0 || targetIndex < 0) return;
      const alreadyAtPosition =
        position === "before"
          ? draggingIndex === targetIndex - 1
          : draggingIndex === targetIndex + 1;
      if (alreadyAtPosition) return;

      previousTabLayouts.current = captureTabLayouts();
      cancelTabAnimations();
      controller.reorder(currentDraggingId, targetId, position);
    },
    [cancelTabAnimations, captureTabLayouts, controller, surfaces],
  );
  const previewReorderAt = useCallback(
    (clientX: number) => {
      const targets = surfaces.flatMap((surface) => {
        const element = tabElements.current.get(surface.id);
        return element ? [{ element, surface }] : [];
      });
      if (targets.length === 0) return;
      const target =
        targets.find(({ element }) => clientX <= horizontalLayoutBounds(element).right) ??
        targets.at(-1);
      if (!target) return;
      previewReorder(target.surface.id, horizontalDropPosition(clientX, target.element));
    },
    [previewReorder, surfaces],
  );
  const previewReorderAtRef = useRef(previewReorderAt);
  previewReorderAtRef.current = previewReorderAt;
  const positionDragOverlay = useCallback((clientX: number, clientY: number) => {
    const candidate = pointerDragCandidate.current;
    if (!candidate) return;
    candidate.lastClientX = clientX;
    candidate.lastClientY = clientY;
    const element = dragOverlayElement.current;
    if (!element) return;
    element.style.transform = `translate3d(${clientX - candidate.grabOffsetX}px, ${clientY - candidate.grabOffsetY}px, 0)`;
  }, []);

  useLayoutEffect(() => {
    const candidate = pointerDragCandidate.current;
    if (candidate && draggingIdRef.current === candidate.surfaceId) {
      positionDragOverlay(candidate.lastClientX, candidate.lastClientY);
    }

    const previousLayouts = previousTabLayouts.current;
    if (!previousLayouts) return;
    previousTabLayouts.current = null;

    const currentPositions = new Map<string, number>();
    for (const surface of surfaces) {
      const element = tabElements.current.get(surface.id);
      if (element) currentPositions.set(surface.id, element.getBoundingClientRect().left);
    }
    for (const element of tabElements.current.values()) {
      element.style.removeProperty("transition-property");
    }
    if (reduceMotion) return;

    for (const surface of surfaces) {
      const element = tabElements.current.get(surface.id);
      const previousLeft = previousLayouts.get(surface.id)?.left;
      const currentLeft = currentPositions.get(surface.id);
      if (!element || previousLeft === undefined || currentLeft === undefined) continue;
      const deltaX = previousLeft - currentLeft;
      if (Math.abs(deltaX) < 0.5) continue;

      const animation = element.animate(
        [{ transform: `translateX(${deltaX}px)` }, { transform: "translateX(0)" }],
        {
          duration: TAB_LAYOUT_ANIMATION_DURATION_MS,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
      tabAnimations.current.set(surface.id, animation);
      animation.addEventListener("finish", () => {
        if (tabAnimations.current.get(surface.id) === animation) {
          tabAnimations.current.delete(surface.id);
        }
      });
    }
  }, [draggingId, positionDragOverlay, reduceMotion, surfaces]);

  useLayoutEffect(() => {
    if (!activeSurfaceId) return;
    const list = tabListElement.current;
    const activeTab = tabElements.current.get(activeSurfaceId);
    if (!list || !activeTab) return;

    const viewport = list.getBoundingClientRect();
    const tab = horizontalLayoutBounds(activeTab);
    const delta = workspaceTabScrollDelta(viewport.left, viewport.right, tab.left, tab.right);
    if (Math.abs(delta) < 0.5) return;
    list.scrollBy({
      left: delta,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [activeSurfaceId, reduceMotion, surfaces]);

  useEffect(() => {
    const element = tabListElement.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth) return;
      const dominantDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const delta = wheelDeltaInPixels(dominantDelta, event.deltaMode, element.clientWidth);
      if (delta === 0) return;
      const previousScrollLeft = element.scrollLeft;
      element.scrollLeft += delta;
      if (Math.abs(element.scrollLeft - previousScrollLeft) < 0.5) return;
      event.preventDefault();
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    let autoScrollFrame: number | null = null;
    const stopAutoScroll = () => {
      if (autoScrollFrame === null) return;
      window.cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    };
    const clearPointerDrag = () => {
      stopAutoScroll();
      pointerDragCandidate.current = null;
      draggingIdRef.current = null;
      setDraggingId(null);
    };
    const runAutoScroll = () => {
      autoScrollFrame = null;
      const candidate = pointerDragCandidate.current;
      const element = tabListElement.current;
      if (!candidate || !draggingIdRef.current || !element) return;
      if (element.scrollWidth <= element.clientWidth) return;

      const bounds = element.getBoundingClientRect();
      if (
        candidate.lastClientY < bounds.top - TAB_AUTO_SCROLL_VERTICAL_TOLERANCE_PX ||
        candidate.lastClientY > bounds.bottom + TAB_AUTO_SCROLL_VERTICAL_TOLERANCE_PX
      ) {
        return;
      }

      const velocity = tabAutoScrollVelocity(candidate.lastClientX, bounds);
      if (velocity === 0) return;
      const previousScrollLeft = element.scrollLeft;
      element.scrollLeft += velocity;
      if (Math.abs(element.scrollLeft - previousScrollLeft) < 0.5) return;

      previewReorderAtRef.current(candidate.lastClientX);
      autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
    };
    const scheduleAutoScroll = () => {
      if (autoScrollFrame !== null) return;
      autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
    };
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const candidate = pointerDragCandidate.current;
      if (!candidate || candidate.pointerId !== event.pointerId) return;
      if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
        clearPointerDrag();
        return;
      }

      if (!draggingIdRef.current) {
        const distance = Math.hypot(
          event.clientX - candidate.startX,
          event.clientY - candidate.startY,
        );
        if (distance < TAB_DRAG_ACTIVATION_DISTANCE_PX) return;
        draggingIdRef.current = candidate.surfaceId;
        setDraggingId(candidate.surfaceId);
        tabAnimations.current.get(candidate.surfaceId)?.cancel();
        tabAnimations.current.delete(candidate.surfaceId);
      }

      if (event.cancelable) event.preventDefault();
      positionDragOverlay(event.clientX, event.clientY);
      previewReorderAtRef.current(event.clientX);
      scheduleAutoScroll();
    };
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const candidate = pointerDragCandidate.current;
      if (!candidate || candidate.pointerId !== event.pointerId) return;
      if (draggingIdRef.current === candidate.surfaceId) {
        if (event.cancelable) event.preventDefault();
        previewReorderAtRef.current(event.clientX);
        suppressedClick.current = {
          surfaceId: candidate.surfaceId,
          until: performance.now() + TAB_DRAG_CLICK_SUPPRESSION_MS,
        };
      }
      clearPointerDrag();
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      if (pointerDragCandidate.current?.pointerId !== event.pointerId) return;
      clearPointerDrag();
    };
    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    const handleWindowBlur = () => {
      clearPointerDrag();
      scheduleTabWidthRelease();
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      pointerDragCandidate.current = null;
      draggingIdRef.current = null;
      stopAutoScroll();
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
      if (tabWidthReleaseTimer.current !== null) {
        window.clearTimeout(tabWidthReleaseTimer.current);
        tabWidthReleaseTimer.current = null;
      }
      cancelTabAnimations();
      cancelTabWidthAnimations();
    };
  }, [cancelTabAnimations, cancelTabWidthAnimations, positionDragOverlay, scheduleTabWidthRelease]);

  const draggingSurface = draggingId ? surfacesById[draggingId] : undefined;
  const DraggingIcon = draggingSurface
    ? (definitionByKind.get(draggingSurface.kind)?.icon ?? PanelsTopLeftIcon)
    : PanelsTopLeftIcon;

  return (
    <>
      <div className="relative w-fit min-w-0 max-w-full flex-[0_1_auto] overflow-hidden">
        <div
          ref={tabListElement}
          role="tablist"
          aria-label={t("rightWorkspace.tabs")}
          className="flex w-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onPointerLeave={scheduleTabWidthRelease}
        >
          {surfaces.map((surface, surfaceIndex) => {
            const Icon = definitionByKind.get(surface.kind)?.icon ?? PanelsTopLeftIcon;
            const active = surface.id === activeSurfaceId;
            const canCloseToRight = surfaceIndex < surfaces.length - 1;
            const canCloseOthers = surfaces.length > 1;
            const title = text(surface.title);
            return (
              <ContextMenu key={surface.id}>
                <ContextMenuTrigger
                  ref={(element) => {
                    if (element) tabElements.current.set(surface.id, element);
                    else tabElements.current.delete(surface.id);
                  }}
                  role="presentation"
                  data-state={active ? "active" : "inactive"}
                  data-dragging={draggingId === surface.id ? "true" : undefined}
                  className={cn(
                    "group/tab text-muted-foreground hover:text-foreground data-[state=active]:[color:var(--control-state-foreground-selected)] after:bg-border/70 relative flex h-[var(--button-height-default)] w-40 min-w-20 max-w-40 flex-[1_1_10rem] select-none items-center rounded-[var(--button-radius)] text-xs transition-[background-color,color,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] before:pointer-events-none before:absolute before:inset-0 before:rounded-[var(--button-radius)] before:[background:var(--control-state-background-selected)] before:opacity-0 before:scale-[0.96] before:transition-[opacity,scale] before:duration-200 before:ease-[cubic-bezier(0.32,0.72,0,1)] before:content-[''] after:absolute after:inset-y-1.5 after:end-[-3px] after:w-px after:content-[''] hover:[background:var(--button-background-hover)] last:after:hidden hover:after:hidden focus-within:after:hidden motion-reduce:transition-none motion-reduce:before:transition-none data-[dragging=true]:cursor-grabbing data-[dragging=true]:opacity-25 data-[state=active]:before:opacity-100 data-[state=active]:before:scale-100 data-[state=active]:after:hidden",
                    surfaces.length > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default",
                  )}
                  onPointerDown={(event) => {
                    if (
                      !event.isPrimary ||
                      event.button !== 0 ||
                      (event.target as Element).closest('[data-workspace-tab-close="true"]')
                    ) {
                      return;
                    }

                    // Selecting on press keeps tab activation independent from the drag gesture.
                    // A small pointer movement may suppress the later click, but must not leave
                    // focus styling on one tab while another surface remains active.
                    controller.focus(surface.id);
                    if (surfaces.length < 2) return;

                    const bounds = event.currentTarget.getBoundingClientRect();
                    pointerDragCandidate.current = {
                      grabOffsetX: event.clientX - bounds.left,
                      grabOffsetY: event.clientY - bounds.top,
                      height: bounds.height,
                      lastClientX: event.clientX,
                      lastClientY: event.clientY,
                      pointerId: event.pointerId,
                      startX: event.clientX,
                      startY: event.clientY,
                      surfaceId: surface.id,
                      width: bounds.width,
                    };
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    id={workspaceTabId(surface.id)}
                    aria-controls={workspaceTabPanelId(surface.id)}
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    title={title}
                    className="relative z-10 flex h-full min-w-0 flex-1 items-center gap-2 rounded-s-lg ps-2.5 pe-1 outline-none transition-[padding] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/tab:pe-8 group-focus-within/tab:pe-8 group-data-[state=active]/tab:pe-8 focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none"
                    onClick={(event) => {
                      const suppressed = suppressedClick.current;
                      suppressedClick.current = null;
                      if (
                        suppressed?.surfaceId === surface.id &&
                        performance.now() <= suppressed.until
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                      }
                      controller.focus(surface.id);
                    }}
                    onKeyDown={(event) => {
                      const direction =
                        getComputedStyle(tabListElement.current ?? event.currentTarget)
                          .direction === "rtl"
                          ? "rtl"
                          : "ltr";
                      const nextIndex = nextWorkspaceTabIndex(
                        event.key,
                        surfaceIndex,
                        surfaces.length,
                        direction,
                      );
                      if (nextIndex === undefined) return;
                      event.preventDefault();
                      focusTabAt(nextIndex);
                    }}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-start [mask-image:linear-gradient(to_right,#000_calc(100%_-_0.75rem),transparent)]">
                      {title}
                    </span>
                    {surface.dirty ? (
                      <span
                        className="bg-foreground size-1.5 shrink-0 rounded-full"
                        aria-hidden="true"
                      />
                    ) : null}
                    {surface.pinned ? (
                      <PinIcon className="size-3 shrink-0" aria-hidden="true" />
                    ) : null}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("rightWorkspace.closeTab", { title })}
                    title={t("rightWorkspace.closeTab", { title })}
                    data-workspace-tab-close="true"
                    tabIndex={active ? 0 : -1}
                    className="group/tab-close text-foreground/65 hover:bg-transparent hover:text-foreground pointer-events-none absolute end-[2px] top-1/2 z-10 -translate-y-1/2 scale-90 rounded-md opacity-0 transition-[color,opacity,scale] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/tab:pointer-events-auto group-hover/tab:scale-100 group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:scale-100 group-focus-within/tab:opacity-100 group-data-[state=active]/tab:pointer-events-auto group-data-[state=active]/tab:scale-100 group-data-[state=active]/tab:opacity-100 focus-visible:scale-100 focus-visible:bg-transparent focus-visible:text-foreground focus-visible:opacity-100 active:-translate-y-1/2! motion-reduce:transition-none dark:hover:bg-transparent dark:focus-visible:bg-transparent"
                    onPointerUp={(event) => {
                      if (!event.isPrimary || event.button !== 0) return;
                      event.preventDefault();
                      requestCloseWithTabAnimation(
                        [surface.id],
                        () => controller.close(surface.id),
                        event.pointerType === "mouse",
                      );
                    }}
                    onClick={(event) => {
                      if (event.detail !== 0) return;
                      requestCloseWithTabAnimation(
                        [surface.id],
                        () => controller.close(surface.id),
                        false,
                      );
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-1/2 top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[5px] transition-colors duration-75 group-hover/tab-close:bg-foreground/[0.04] group-focus-visible/tab-close:bg-foreground/[0.04] dark:group-hover/tab-close:bg-background/35 dark:group-focus-visible/tab-close:bg-background/35"
                    >
                      <XIcon className="size-4 scale-[0.875]" />
                    </span>
                  </Button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() =>
                      requestCloseWithTabAnimation(
                        [surface.id],
                        () => controller.close(surface.id),
                        false,
                      )
                    }
                  >
                    {t("rightWorkspace.closeTabAction")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!canCloseToRight}
                    onClick={() =>
                      requestCloseWithTabAnimation(
                        surfaces.slice(surfaceIndex + 1).map((candidate) => candidate.id),
                        () => controller.closeToRight(surface.id, context),
                        false,
                      )
                    }
                  >
                    {t("rightWorkspace.closeToRight")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!canCloseOthers}
                    onClick={() =>
                      requestCloseWithTabAnimation(
                        surfaces
                          .filter((candidate) => candidate.id !== surface.id)
                          .map((candidate) => candidate.id),
                        () => controller.closeOthers(surface.id, context),
                        false,
                      )
                    }
                  >
                    {t("rightWorkspace.closeOthers")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </div>
      {draggingSurface && pointerDragCandidate.current && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                aria-hidden="true"
                data-workspace-tab-drag-shield="true"
                className="fixed inset-0 z-[2147483646] cursor-grabbing"
              />
              <div
                ref={dragOverlayElement}
                aria-hidden="true"
                data-workspace-tab-drag-overlay="true"
                className="bg-muted text-foreground pointer-events-none fixed left-0 top-0 z-[2147483647] flex animate-in select-none items-center gap-2 overflow-hidden rounded-lg px-2.5 text-xs opacity-95 shadow-xl ring-1 ring-black/10 fade-in-0 duration-100 will-change-transform motion-reduce:animate-none dark:ring-white/10"
                style={{
                  height: pointerDragCandidate.current.height,
                  width: pointerDragCandidate.current.width,
                }}
              >
                <DraggingIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-start [mask-image:linear-gradient(to_right,#000_calc(100%_-_0.75rem),transparent)]">
                  {text(draggingSurface.title)}
                </span>
                {draggingSurface.dirty ? (
                  <span className="bg-foreground size-1.5 shrink-0 rounded-full" />
                ) : null}
                {draggingSurface.pinned ? <PinIcon className="size-3 shrink-0" /> : null}
              </div>
            </>,
            document.body,
          )
        : null}
      <Dialog
        open={pendingClose !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingClose(undefined);
        }}
      >
        <DialogContent closeLabel={t("rightWorkspace.closeDiscardDialog")}>
          <DialogHeader>
            <DialogTitle>{t("rightWorkspace.discardUnsavedTitle")}</DialogTitle>
            <DialogDescription>
              {t("rightWorkspace.confirmDiscardUnsaved", {
                count:
                  pendingClose?.closedSurfaceIds.reduce(
                    (count, surfaceId) => count + (surfacesById[surfaceId]?.dirty ? 1 : 0),
                    0,
                  ) ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter closeLabel={t("rightWorkspace.keepEditing")} className="m-0">
            <Button
              type="button"
              variant="outline"
              autoFocus
              onClick={() => setPendingClose(undefined)}
            >
              {t("rightWorkspace.keepEditing")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!pendingClose) return;
                setPendingClose(undefined);
                closeWithTabAnimation(
                  pendingClose.closedSurfaceIds,
                  pendingClose.close,
                  pendingClose.holdWidthsForPointer,
                );
              }}
            >
              {t("rightWorkspace.discardAndClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
