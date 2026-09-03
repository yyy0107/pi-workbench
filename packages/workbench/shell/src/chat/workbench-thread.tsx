"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";

import { cn } from "../utils";
import { resolvePromotedThreadRouteId, shouldProjectNewThreadRoute } from "../new-thread-policy";
import { THREAD_CONTENT_WIDTH_CLASS_NAME } from "../layout";
import { useWorkbenchNavigation } from "../navigation";
import { useThreadScrollState } from "../thread-scroll-state";

import { WorkbenchComposer } from "./workbench-composer";
import { WorkbenchConversation } from "./workbench-conversation";

const BOTTOM_DISTANCE_THRESHOLD = 2;
const DEFAULT_COMPOSER_DOCK_INSET_PX = 138;
function readViewportPosition(viewport: HTMLElement) {
  const distanceFromBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
  return {
    scrollTop: Math.max(0, viewport.scrollTop),
    atBottom:
      Math.abs(distanceFromBottom) <= BOTTOM_DISTANCE_THRESHOLD ||
      viewport.scrollHeight <= viewport.clientHeight,
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

/**
 * Synchronizes a route id only after the thread list proves that it exists.
 * Unknown or stale ids intentionally leave the current thread mounted.
 */
export function ThreadRouteSync({ threadId }: { threadId?: string }) {
  const aui = useAui();
  const navigation = useWorkbenchNavigation();
  const observedRouteId = useRef<string | null>(null);
  const syncedRouteId = useRef<string | null>(null);
  const newThreadNavigationPending = useRef(false);
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const activeMessageCount = useAuiState((state) => state.thread.messages.length);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const archivedThreadIds = useAuiState((state) => state.threads.archivedThreadIds);
  const isInitialLoading = isLoading && threadIds.length + archivedThreadIds.length === 0;
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const mainThread = threadItems.find((item) => item.id === mainThreadId);

  useLayoutEffect(() => {
    const routeId = threadId ?? "";
    if (isInitialLoading) return;
    const routeChanged = observedRouteId.current !== routeId;
    observedRouteId.current = routeId;

    if (!threadId) {
      newThreadNavigationPending.current = false;
      if (routeChanged) {
        syncedRouteId.current = routeId;

        try {
          aui.threads.switchToNewThread();
        } catch {
          // The thread list can change between the state read and route update.
        }
        return;
      }

      // assistant-ui promotes the draft before its append pipeline reaches `onNew`. Navigating
      // during that gap invalidates the thread generation and silently drops the first send.
      // The optimistic user message is the earliest safe signal that `onNew` has started.
      const nextRouteId = resolvePromotedThreadRouteId({
        mainThreadId,
        newThreadId,
        status: mainThread?.status,
        remoteId: mainThread?.remoteId,
        externalId: mainThread?.externalId,
        hasMessages: activeMessageCount > 0,
      });
      if (nextRouteId) {
        if (syncedRouteId.current === nextRouteId) return;
        syncedRouteId.current = nextRouteId;
        navigation.openConversation(nextRouteId, { replace: true });
      }
      return;
    }

    if (
      newThreadNavigationPending.current ||
      shouldProjectNewThreadRoute({
        routeThreadId: threadId,
        syncedRouteThreadId: syncedRouteId.current,
        isNewThread: mainThreadId === newThreadId,
      })
    ) {
      if (!newThreadNavigationPending.current) {
        newThreadNavigationPending.current = true;
        navigation.openHome();
      }
      return;
    }

    const item = threadItems.find(
      (candidate) =>
        candidate.id === threadId ||
        candidate.remoteId === threadId ||
        candidate.externalId === threadId,
    );
    const resolvedId = item?.id ?? (threadIds.includes(threadId) ? threadId : undefined);

    if (!resolvedId) return;

    const canonicalRouteId = item?.remoteId ?? item?.externalId;
    if (canonicalRouteId && canonicalRouteId !== threadId) {
      syncedRouteId.current = canonicalRouteId;
      navigation.openConversation(canonicalRouteId, { replace: true });
      return;
    }

    syncedRouteId.current = routeId;
    if (resolvedId === mainThreadId) return;

    try {
      aui.threads.switchToThread(resolvedId);
    } catch {
      // A runtime can invalidate a thread between the state read and switch.
      // Keeping the current thread is the safe route-level fallback.
    }
  }, [
    activeMessageCount,
    archivedThreadIds,
    aui,
    isLoading,
    isInitialLoading,
    mainThread,
    mainThreadId,
    navigation,
    newThreadId,
    threadId,
    threadIds,
    threadItems,
  ]);

  return null;
}

export function MainConversationHost() {
  const threadScrollState = useThreadScrollState();
  const { currentConversationId: threadId } = useWorkbenchNavigation();
  const activeThreadId = useAuiState((state) => state.threads.mainThreadId);
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const isThreadLoading = useAuiState((state) => state.thread.isLoading);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isHistoryLoading = Boolean(threadId) && isThreadLoading;
  const hasDockedComposer = !isEmpty || isHistoryLoading;
  const viewportRef = useRef<HTMLDivElement>(null);
  const threadFrameRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const measuredComposerDockInset = useRef(DEFAULT_COMPOSER_DOCK_INSET_PX);
  const [composerDockInset, setComposerDockInset] = useState(DEFAULT_COMPOSER_DOCK_INSET_PX);
  const wasAtBottom = useRef(true);
  const previousIsRunning = useRef(isRunning);
  const scrollPositionThreadId = useRef(activeThreadId);
  const scrollRestorationActive = useRef(false);
  const scrollRestorationCleanup = useRef<(() => void) | null>(null);

  const stopScrollRestoration = useCallback(() => {
    scrollRestorationCleanup.current?.();
    scrollRestorationCleanup.current = null;
    scrollRestorationActive.current = false;
  }, []);

  const rememberCurrentScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const currentThreadId = scrollPositionThreadId.current;
    if (!viewport || !currentThreadId || scrollRestorationActive.current) return;

    const position = readViewportPosition(viewport);
    wasAtBottom.current = position.atBottom;
    threadScrollState.save(currentThreadId, position);
  }, [threadScrollState]);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
  }, []);

  useLayoutEffect(() => {
    if (!hasDockedComposer) return;

    const threadFrame = threadFrameRef.current;
    const composerDock = composerDockRef.current;
    if (!threadFrame || !composerDock) return;

    const syncComposerDockInset = () => {
      const measuredHeight = composerDock.getBoundingClientRect().height;
      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return;

      const nextInset = Math.ceil(measuredHeight);
      if (measuredComposerDockInset.current === nextInset) return;

      const shouldRemainAtBottom = wasAtBottom.current;
      measuredComposerDockInset.current = nextInset;

      // Apply the measured value immediately so the browser cannot paint a frame where a newly
      // inserted queue row overlaps the conversation. State keeps React's style model in sync.
      threadFrame.style.setProperty("--composer-dock-inset", `${nextInset}px`);
      if (shouldRemainAtBottom) {
        scrollToBottom();
        wasAtBottom.current = true;
      }
      setComposerDockInset(nextInset);
    };

    syncComposerDockInset();
    const resizeObserver = new ResizeObserver(syncComposerDockInset);
    resizeObserver.observe(composerDock);
    return () => resizeObserver.disconnect();
  }, [activeThreadId, hasDockedComposer, scrollToBottom]);

  useLayoutEffect(() => {
    stopScrollRestoration();
    scrollPositionThreadId.current = activeThreadId;

    const viewport = viewportRef.current;
    if (!viewport || !activeThreadId) return;

    const savedPosition = threadScrollState.get(activeThreadId);
    const restoreToBottom = savedPosition?.atBottom ?? true;
    const savedScrollTop = savedPosition?.scrollTop ?? 0;
    let frame: number | null = null;
    let timeout: number | null = null;
    let stopped = false;

    const applyPosition = () => {
      if (stopped) return;

      if (restoreToBottom) {
        scrollToBottom();
        wasAtBottom.current = true;
        return;
      }

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTo({
        top: Math.min(savedScrollTop, maxScrollTop),
        behavior: "instant",
      });
      // Keep ThreadPrimitive's isAtBottom store in sync with the restored DOM position so
      // auto-scroll does not reclaim a deliberately restored point in the history.
      viewport.dispatchEvent(new Event("scroll"));
      wasAtBottom.current = false;
    };
    const schedulePosition = () => {
      if (stopped || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        applyPosition();
      });
    };
    const disconnectContentObserver = observeViewportContent(viewport, schedulePosition);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      disconnectContentObserver();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (timeout !== null) window.clearTimeout(timeout);
      if (scrollRestorationCleanup.current === stop) {
        scrollRestorationCleanup.current = null;
        scrollRestorationActive.current = false;
      }
    };
    const finish = () => {
      applyPosition();
      stop();
      rememberCurrentScrollPosition();
    };

    scrollRestorationActive.current = true;
    scrollRestorationCleanup.current = stop;
    timeout = window.setTimeout(finish, 5_000);
    applyPosition();
    schedulePosition();

    return stop;
  }, [
    activeThreadId,
    rememberCurrentScrollPosition,
    scrollToBottom,
    stopScrollRestoration,
    threadScrollState,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateBottomState = () => {
      if (scrollRestorationActive.current) return;
      rememberCurrentScrollPosition();
    };
    const cancelScrollFollow = () => {
      stopScrollRestoration();
    };

    updateBottomState();
    viewport.addEventListener("scroll", updateBottomState, { passive: true });
    viewport.addEventListener("pointerdown", cancelScrollFollow, { passive: true });
    viewport.addEventListener("wheel", cancelScrollFollow, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", updateBottomState);
      viewport.removeEventListener("pointerdown", cancelScrollFollow);
      viewport.removeEventListener("wheel", cancelScrollFollow);
      stopScrollRestoration();
      rememberCurrentScrollPosition();
    };
  }, [rememberCurrentScrollPosition, stopScrollRestoration]);

  useLayoutEffect(() => {
    const wasRunning = previousIsRunning.current;
    const runStarted = !wasRunning && isRunning;
    const runFinishedAtBottom = wasRunning && !isRunning && wasAtBottom.current;
    previousIsRunning.current = isRunning;

    if (runStarted) {
      // ThreadPrimitive schedules its run-start scroll for the next frame. Cancel any progressive
      // history restoration before then so that assistant-ui remains the only writer for this run.
      stopScrollRestoration();
      wasAtBottom.current = true;
      return;
    }

    if (!runFinishedAtBottom) return;

    // Preserve an existing bottom-follow intent across the final Markdown reflow and action-bar
    // layout without reclaiming users who deliberately scrolled up during the run.
    scrollToBottom();
    wasAtBottom.current = true;
    const frame = window.requestAnimationFrame(() => {
      if (wasAtBottom.current) scrollToBottom();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isRunning, scrollToBottom, stopScrollRestoration]);

  return (
    <WorkbenchConversation
      threadId={threadId ?? activeThreadId}
      sessionId={activeThreadId}
      hostContent={<ThreadRouteSync threadId={threadId} />}
      emptyComposer={<WorkbenchComposer />}
      composerDock={
        <div
          ref={composerDockRef}
          data-workbench-composer-dock=""
          className={cn(
            THREAD_CONTENT_WIDTH_CLASS_NAME,
            "absolute bottom-0 z-20 mx-auto flex flex-col bg-transparent pt-[var(--composer-dock-top-gap)] pb-[var(--composer-dock-bottom-gap)] [inset-inline:var(--thread-viewport-inline-padding)] [overflow-anchor:none]",
          )}
        >
          <WorkbenchComposer />
        </div>
      }
      showHistoryLoading={Boolean(threadId)}
      viewportRef={viewportRef}
      frameRef={threadFrameRef}
      composerDockInset={composerDockInset}
      autoScroll
    />
  );
}

/** Backward-compatible page entry; MainConversationHost owns all MainView-only behavior. */
export function WorkbenchThread() {
  return <MainConversationHost />;
}
