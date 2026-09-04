"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { useThreadScrollState } from "../thread-scroll-state";

const BOTTOM_DISTANCE_THRESHOLD = 2;
const TOP_DISTANCE_THRESHOLD = 32;

export interface ConversationViewportMetrics {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}

export function conversationViewportAtBottom(metrics: ConversationViewportMetrics): boolean {
  const distance = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return (
    Math.abs(distance) <= BOTTOM_DISTANCE_THRESHOLD || metrics.scrollHeight <= metrics.clientHeight
  );
}

export function conversationViewportAtTop(metrics: ConversationViewportMetrics): boolean {
  return metrics.scrollTop <= TOP_DISTANCE_THRESHOLD;
}

export function nextConversationViewportScrollTop({
  current,
  followBottom,
  prepended,
  previousScrollHeight,
}: Readonly<{
  current: ConversationViewportMetrics;
  followBottom: boolean;
  prepended: boolean;
  previousScrollHeight: number;
}>): number | undefined {
  const maxScrollTop = Math.max(0, current.scrollHeight - current.clientHeight);
  if (followBottom) return maxScrollTop;
  if (!prepended || current.scrollHeight <= previousScrollHeight) return undefined;
  return Math.min(maxScrollTop, current.scrollTop + current.scrollHeight - previousScrollHeight);
}

function readViewportMetrics(viewport: HTMLElement): ConversationViewportMetrics {
  return {
    clientHeight: viewport.clientHeight,
    scrollHeight: viewport.scrollHeight,
    scrollTop: Math.max(0, viewport.scrollTop),
  };
}

function observeViewportContent(viewport: HTMLElement, onChange: () => void): () => void {
  const observedElements = new Set<Element>();
  const resizeObserver = new ResizeObserver(onChange);
  const observeElements = () => {
    for (const element of [viewport, ...viewport.children]) {
      if (observedElements.has(element)) continue;
      observedElements.add(element);
      resizeObserver.observe(element);
    }
  };
  const mutationObserver = new MutationObserver(() => {
    observeElements();
    onChange();
  });

  observeElements();
  mutationObserver.observe(viewport, { childList: true, subtree: true });

  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
  };
}

export function useWorkbenchConversationViewport({
  autoScroll,
  isRunning,
  nodeKeys,
  onReachTop,
  scrollToBottomOnInitialize,
  sessionId,
}: Readonly<{
  autoScroll: boolean;
  isRunning: boolean;
  nodeKeys: readonly string[];
  onReachTop?: () => void;
  scrollToBottomOnInitialize: boolean;
  sessionId: string;
}>) {
  const scrollState = useThreadScrollState();
  const [initialPosition] = useState(() =>
    scrollToBottomOnInitialize ? undefined : scrollState.get(sessionId),
  );
  const [isAtBottom, setIsAtBottom] = useState(initialPosition?.atBottom ?? true);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const followBottom = useRef(initialPosition?.atBottom ?? true);
  const pendingScrollBehavior = useRef<ScrollBehavior | null>(null);
  const restoring = useRef(false);
  const restorationScrollTop = useRef<number | null>(null);
  const restorationTimeout = useRef<number | null>(null);
  const lastMetrics = useRef<ConversationViewportMetrics | undefined>(undefined);
  const previousNodeKeys = useRef(nodeKeys);
  const previousIsRunning = useRef(isRunning);

  const setViewportRef = useCallback((viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport;
  }, []);

  const stopRestoration = useCallback(() => {
    if (restorationTimeout.current !== null) {
      window.clearTimeout(restorationTimeout.current);
      restorationTimeout.current = null;
    }
    restoring.current = false;
    restorationScrollTop.current = null;
  }, []);

  const rememberPosition = useCallback(
    (viewport: HTMLElement) => {
      const metrics = readViewportMetrics(viewport);
      const atBottom = conversationViewportAtBottom(metrics);
      lastMetrics.current = metrics;
      setIsAtBottom((current) => (current === atBottom ? current : atBottom));
      if (!restoring.current && pendingScrollBehavior.current === null) {
        scrollState.save(sessionId, { scrollTop: metrics.scrollTop, atBottom });
      }
      return { atBottom, metrics };
    },
    [scrollState, sessionId],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      stopRestoration();
      followBottom.current = true;
      pendingScrollBehavior.current = behavior;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      const position = rememberPosition(viewport);
      if (position.atBottom && position.metrics.scrollHeight > position.metrics.clientHeight + 1) {
        pendingScrollBehavior.current = null;
        scrollState.save(sessionId, { scrollTop: position.metrics.scrollTop, atBottom: true });
      }
    },
    [rememberPosition, scrollState, sessionId, stopRestoration],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const restoreAtBottom = initialPosition?.atBottom ?? true;
    const restoreScrollTop = initialPosition?.scrollTop ?? 0;
    stopRestoration();
    restoring.current = true;
    restorationScrollTop.current = restoreAtBottom ? null : restoreScrollTop;
    followBottom.current = restoreAtBottom;
    pendingScrollBehavior.current = restoreAtBottom ? "instant" : null;

    const apply = () => {
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTo({
        top: restoreAtBottom ? viewport.scrollHeight : Math.min(restoreScrollTop, maxScrollTop),
        behavior: "instant",
      });
      rememberPosition(viewport);
    };

    apply();
    const frame = window.requestAnimationFrame(() => {
      apply();
      if (restoreAtBottom) {
        restoring.current = false;
        const position = rememberPosition(viewport);
        if (position.metrics.scrollHeight > position.metrics.clientHeight + 1) {
          pendingScrollBehavior.current = null;
          scrollState.save(sessionId, { scrollTop: position.metrics.scrollTop, atBottom: true });
        }
        return;
      }

      const timeout = window.setTimeout(() => {
        apply();
        if (restorationTimeout.current === timeout) restorationTimeout.current = null;
        restoring.current = false;
        restorationScrollTop.current = null;
        rememberPosition(viewport);
      }, 5_000);
      restorationTimeout.current = timeout;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (restorationTimeout.current !== null) {
        window.clearTimeout(restorationTimeout.current);
        restorationTimeout.current = null;
      }
    };
  }, [initialPosition, rememberPosition, scrollState, sessionId, stopRestoration]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || previousNodeKeys.current === nodeKeys) return;

    const previousFirstNode = previousNodeKeys.current[0];
    const prepended = previousFirstNode !== undefined && nodeKeys.indexOf(previousFirstNode) > 0;
    const current = readViewportMetrics(viewport);
    const nextScrollTop = nextConversationViewportScrollTop({
      current,
      followBottom: pendingScrollBehavior.current !== null || (autoScroll && followBottom.current),
      prepended,
      previousScrollHeight: lastMetrics.current?.scrollHeight ?? current.scrollHeight,
    });

    previousNodeKeys.current = nodeKeys;
    if (nextScrollTop !== undefined) {
      viewport.scrollTo({ top: nextScrollTop, behavior: "instant" });
    }
    const position = rememberPosition(viewport);
    if (position.atBottom && position.metrics.scrollHeight > position.metrics.clientHeight + 1) {
      pendingScrollBehavior.current = null;
      scrollState.save(sessionId, { scrollTop: position.metrics.scrollTop, atBottom: true });
    }
  }, [autoScroll, nodeKeys, rememberPosition, scrollState, sessionId]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      const metrics = readViewportMetrics(viewport);
      if (conversationViewportAtBottom(metrics)) {
        followBottom.current = true;
        if (metrics.scrollHeight > metrics.clientHeight + 1) {
          pendingScrollBehavior.current = null;
        }
      } else if (pendingScrollBehavior.current === null) {
        followBottom.current = false;
      }
      rememberPosition(viewport);
    };
    const cancelPendingScroll = () => {
      stopRestoration();
      pendingScrollBehavior.current = null;
    };
    const handleContentChange = () => {
      const current = readViewportMetrics(viewport);
      if (restoring.current && restorationScrollTop.current !== null) {
        viewport.scrollTo({
          top: Math.min(
            restorationScrollTop.current,
            Math.max(0, current.scrollHeight - current.clientHeight),
          ),
          behavior: "instant",
        });
        handleScroll();
        return;
      }
      const shouldFollow =
        pendingScrollBehavior.current !== null || (autoScroll && followBottom.current);
      if (shouldFollow) {
        viewport.scrollTo({
          top: current.scrollHeight,
          behavior: pendingScrollBehavior.current ?? "instant",
        });
      }
      handleScroll();
    };

    const handleViewportScroll = () => {
      handleScroll();
      if (conversationViewportAtTop(readViewportMetrics(viewport))) onReachTop?.();
    };

    viewport.addEventListener("scroll", handleViewportScroll, { passive: true });
    viewport.addEventListener("pointerdown", cancelPendingScroll, { passive: true });
    viewport.addEventListener("wheel", cancelPendingScroll, { passive: true });
    const disconnectContentObserver = observeViewportContent(viewport, handleContentChange);
    handleScroll();

    return () => {
      viewport.removeEventListener("scroll", handleViewportScroll);
      viewport.removeEventListener("pointerdown", cancelPendingScroll);
      viewport.removeEventListener("wheel", cancelPendingScroll);
      disconnectContentObserver();
      const restorationTarget = restorationScrollTop.current;
      if (restorationTarget !== null) {
        scrollState.save(sessionId, { scrollTop: restorationTarget, atBottom: false });
        return;
      }
      const position = readViewportMetrics(viewport);
      scrollState.save(sessionId, {
        scrollTop: position.scrollTop,
        atBottom:
          conversationViewportAtBottom(position) ||
          (followBottom.current && pendingScrollBehavior.current !== null),
      });
    };
  }, [autoScroll, onReachTop, rememberPosition, scrollState, sessionId, stopRestoration]);

  useLayoutEffect(() => {
    const runStarted = !previousIsRunning.current && isRunning;
    previousIsRunning.current = isRunning;
    if (runStarted) scrollToBottom("auto");
  }, [isRunning, scrollToBottom]);

  return { isAtBottom, scrollToBottom, viewportRef: setViewportRef };
}
