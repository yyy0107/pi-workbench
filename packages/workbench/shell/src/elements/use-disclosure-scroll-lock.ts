"use client";

import { useCallback, useEffect, useRef } from "react";

import { useDisclosureScrollsUpward } from "./disclosure-scroll-direction";
import {
  preservesBothScrollbarGutters,
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
  const initialRootHeight = initialRootRect.height;
  const initialScrollTop = scrollContainer.scrollTop;
  let targetScrollTop = initialScrollTop;
  let stopped = false;

  const computed = getComputedStyle(scrollContainer);
  const hasSymmetricScrollbarGutter = preservesBothScrollbarGutters(
    computed.getPropertyValue("scrollbar-gutter"),
  );
  const paddingSide = computed.direction === "rtl" ? "paddingLeft" : "paddingRight";
  const previousPadding = scrollContainer.style[paddingSide];
  const previousScrollBehavior = scrollContainer.style.scrollBehavior;
  const previousScrollbarWidth = scrollContainer.style.scrollbarWidth;

  scrollContainer.style.scrollBehavior = "auto";
  if (!hasSymmetricScrollbarGutter) {
    const scrollbarSize =
      scrollContainer.offsetWidth -
      scrollContainer.clientWidth -
      Number.parseFloat(computed.borderLeftWidth) -
      Number.parseFloat(computed.borderRightWidth);

    scrollContainer.style.scrollbarWidth = "none";
    if (scrollbarSize > 0) {
      scrollContainer.style[paddingSide] =
        `${Number.parseFloat(computed[paddingSide]) + scrollbarSize}px`;
    }
  }

  const applyPosition = () => {
    if (opening) {
      const heightIncrease = root.getBoundingClientRect().height - initialRootHeight;
      targetScrollTop = initialScrollTop + upwardDisclosureScrollDelta(heightIncrease);
    }

    if (Math.abs(scrollContainer.scrollTop - targetScrollTop) > 0.5) {
      scrollContainer.scrollTop = targetScrollTop;
    }
  };
  // Measure after layout and compensate before paint, including Base UI's deferred first frame.
  const resizeObserver = new ResizeObserver(applyPosition);
  const handleScroll = () => applyPosition();
  const restoreStyles = () => {
    scrollContainer.style.scrollBehavior = previousScrollBehavior;
    if (!hasSymmetricScrollbarGutter) {
      scrollContainer.style.scrollbarWidth = previousScrollbarWidth;
      scrollContainer.style[paddingSide] = previousPadding;
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    resizeObserver.disconnect();
    window.clearTimeout(timeoutId);
    scrollContainer.removeEventListener("scroll", handleScroll);
    applyPosition();
    restoreStyles();
  };
  const finishTransition = () => {
    if (stopped) return;
    const animations = root
      .getAnimations({ subtree: true })
      .filter(
        (animation) =>
          animation.playState === "running" &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime),
      );
    // The CSS transition starts after the click; streaming shimmer animations never finish.
    if (animations.length === 0) stop();
    else
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(
        finishTransition,
      );
  };

  scrollContainer.addEventListener("scroll", handleScroll);
  resizeObserver.observe(root);
  const timeoutId = window.setTimeout(finishTransition, duration);

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
    (opening: boolean, duration = DISCLOSURE_ANIMATION_DURATION) => {
      cleanupRef.current?.();
      cleanupRef.current = null;

      const root = rootRef.current;
      if (!root) return;
      cleanupRef.current = lockDisclosureTransition(
        root,
        shouldCompensateDisclosureOpening(opening, preferUpward),
        duration,
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
