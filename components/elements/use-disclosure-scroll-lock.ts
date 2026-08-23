"use client";

import { useCallback, useEffect, useRef } from "react";

import { useDisclosureScrollsUpward } from "./disclosure-scroll-direction";
import {
  shouldCompensateDisclosureOpening,
  upwardDisclosureScrollDelta,
} from "./disclosure-scroll-policy";

const DISCLOSURE_ANIMATION_DURATION = 200;

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let ancestor = element.parentElement;

  while (ancestor) {
    const { overflowY } = getComputedStyle(ancestor);
    if (overflowY === "auto" || overflowY === "scroll") return ancestor;
    ancestor = ancestor.parentElement;
  }

  return null;
}

function lockDisclosureTransition(
  root: HTMLElement,
  opening: boolean,
  duration: number,
): () => void {
  const scrollContainer = findScrollContainer(root);
  if (!scrollContainer) return () => undefined;

  const initialRootRect = root.getBoundingClientRect();
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  const visibleContainerTop = Math.max(0, scrollContainerRect.top + scrollContainer.clientTop);
  const visibleSpaceAbove = Math.max(0, initialRootRect.top - visibleContainerTop);
  const initialRootHeight = initialRootRect.height;
  const initialScrollTop = scrollContainer.scrollTop;
  let targetScrollTop = initialScrollTop;
  let frameId: number | null = null;
  let stopped = false;

  const computed = getComputedStyle(scrollContainer);
  const paddingSide = computed.direction === "rtl" ? "paddingLeft" : "paddingRight";
  const previousPadding = scrollContainer.style[paddingSide];
  const previousScrollBehavior = scrollContainer.style.scrollBehavior;
  const previousScrollbarWidth = scrollContainer.style.scrollbarWidth;
  const scrollbarSize =
    scrollContainer.offsetWidth -
    scrollContainer.clientWidth -
    Number.parseFloat(computed.borderLeftWidth) -
    Number.parseFloat(computed.borderRightWidth);

  scrollContainer.style.scrollBehavior = "auto";
  scrollContainer.style.scrollbarWidth = "none";
  if (scrollbarSize > 0) {
    scrollContainer.style[paddingSide] =
      `${Number.parseFloat(computed[paddingSide]) + scrollbarSize}px`;
  }

  const applyPosition = () => {
    if (opening) {
      const heightIncrease = root.getBoundingClientRect().height - initialRootHeight;
      targetScrollTop =
        initialScrollTop + upwardDisclosureScrollDelta(heightIncrease, visibleSpaceAbove);
    }

    if (Math.abs(scrollContainer.scrollTop - targetScrollTop) > 0.5) {
      scrollContainer.scrollTop = targetScrollTop;
    }
  };
  const followAnimation = () => {
    if (stopped) return;
    applyPosition();
    frameId = window.requestAnimationFrame(followAnimation);
  };
  const handleScroll = () => applyPosition();
  const restoreStyles = () => {
    scrollContainer.style.scrollBehavior = previousScrollBehavior;
    scrollContainer.style.scrollbarWidth = previousScrollbarWidth;
    scrollContainer.style[paddingSide] = previousPadding;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    window.clearTimeout(timeoutId);
    scrollContainer.removeEventListener("scroll", handleScroll);
    applyPosition();
    restoreStyles();
  };

  scrollContainer.addEventListener("scroll", handleScroll);
  if (opening) frameId = window.requestAnimationFrame(followAnimation);
  const timeoutId = window.setTimeout(stop, duration);

  return stop;
}

export function useDisclosureScrollLock<T extends HTMLElement = HTMLDivElement>(
  onOpenChange: (open: boolean) => void,
) {
  const preferUpward = useDisclosureScrollsUpward();
  const rootRef = useRef<T>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const prepareDisclosureTransition = useCallback(
    (opening: boolean) => {
      cleanupRef.current?.();
      cleanupRef.current = null;

      const root = rootRef.current;
      if (!root) return;
      cleanupRef.current = lockDisclosureTransition(
        root,
        shouldCompensateDisclosureOpening(opening, preferUpward),
        DISCLOSURE_ANIMATION_DURATION,
      );
    },
    [preferUpward],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      prepareDisclosureTransition(open);
      onOpenChange(open);
    },
    [onOpenChange, prepareDisclosureTransition],
  );

  return [rootRef, handleOpenChange, prepareDisclosureTransition] as const;
}
