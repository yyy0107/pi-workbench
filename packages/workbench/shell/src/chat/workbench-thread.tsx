"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";

import { cn } from "../utils";
import { resolvePromotedThreadRouteId, shouldProjectNewThreadRoute } from "../new-thread-policy";
import { THREAD_CONTENT_WIDTH_CLASS_NAME } from "../layout";
import { useWorkbenchNavigation } from "../navigation";

import { WorkbenchComposer } from "./workbench-composer";
import { WorkbenchConversation } from "./workbench-conversation";

const DEFAULT_COMPOSER_DOCK_INSET_PX = 138;

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
  const { currentConversationId: threadId } = useWorkbenchNavigation();
  const activeThreadId = useAuiState((state) => state.threads.mainThreadId);
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const isThreadLoading = useAuiState((state) => state.thread.isLoading);
  const isHistoryLoading = Boolean(threadId) && isThreadLoading;
  const hasDockedComposer = !isEmpty || isHistoryLoading;
  const composerDockRef = useRef<HTMLDivElement>(null);
  const [composerDockInset, setComposerDockInset] = useState(DEFAULT_COMPOSER_DOCK_INSET_PX);

  useLayoutEffect(() => {
    if (!hasDockedComposer) return;

    const composerDock = composerDockRef.current;
    if (!composerDock) return;

    const syncComposerDockInset = () => {
      const measuredHeight = composerDock.getBoundingClientRect().height;
      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return;
      const nextInset = Math.ceil(measuredHeight);
      setComposerDockInset((current) => (current === nextInset ? current : nextInset));
    };

    syncComposerDockInset();
    const resizeObserver = new ResizeObserver(syncComposerDockInset);
    resizeObserver.observe(composerDock);
    return () => resizeObserver.disconnect();
  }, [activeThreadId, hasDockedComposer]);

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
      composerDockInset={composerDockInset}
      autoScroll
    />
  );
}

/** Backward-compatible page entry; MainConversationHost owns all MainView-only behavior. */
export function WorkbenchThread() {
  return <MainConversationHost />;
}
