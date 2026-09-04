"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  SessionProvider,
  useAgentRuntime,
  useCurrentSession,
  useSessionState,
  useThreadList,
} from "@workbench/agent-runtime-client";

import { cn } from "../utils";
import { resolvePromotedThreadRouteId, shouldProjectNewThreadRoute } from "../new-thread-policy";
import { THREAD_CONTENT_WIDTH_CLASS_NAME } from "../layout";
import { useWorkbenchNavigation } from "../navigation";

import { WorkbenchComposer } from "./workbench-composer";
import { WorkbenchConversationContent } from "./workbench-conversation";

const DEFAULT_COMPOSER_DOCK_INSET_PX = 138;

/**
 * Synchronizes a route id only after the thread list proves that it exists.
 * Unknown or stale ids intentionally leave the current thread mounted.
 */
export function ThreadRouteSync({ threadId }: { threadId?: string }) {
  const runtime = useAgentRuntime();
  const navigation = useWorkbenchNavigation();
  const observedRouteId = useRef<string | null>(null);
  const syncedRouteId = useRef<string | null>(null);
  const newThreadNavigationPending = useRef(false);
  const current = useCurrentSession();
  const activeMessageCount = useSessionState((snapshot) => snapshot.nodeKeys.length);
  const catalog = useThreadList();
  const isInitialLoading = catalog.isLoading && catalog.threads.length === 0;

  useLayoutEffect(() => {
    const routeId = threadId ?? "";
    if (isInitialLoading) return;
    const routeChanged = observedRouteId.current !== routeId;
    observedRouteId.current = routeId;

    if (!threadId) {
      newThreadNavigationPending.current = false;
      if (routeChanged) {
        syncedRouteId.current = routeId;
        if (!current.isNewThread) runtime.switchToNewThread();
        return;
      }

      // Draft promotion keeps the in-memory Session id and publishes its durable route identity.
      // Wait for the optimistic user Node before replacing the home URL so the first send remains
      // mounted throughout admission.
      const nextRouteId = resolvePromotedThreadRouteId({
        isNewThread: current.isNewThread,
        threadId: current.threadId,
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
        isNewThread: current.isNewThread,
      })
    ) {
      if (!newThreadNavigationPending.current) {
        newThreadNavigationPending.current = true;
        navigation.openHome();
      }
      return;
    }

    const item = catalog.threads.find((candidate) => candidate.threadId === threadId);
    if (!item) return;

    syncedRouteId.current = routeId;
    if (current.threadId === item.threadId) return;

    try {
      runtime.switchToThread(item.threadId);
    } catch {
      // A runtime can invalidate a thread between the state read and switch.
      // Keeping the current thread is the safe route-level fallback.
    }
  }, [activeMessageCount, catalog, current, isInitialLoading, navigation, runtime, threadId]);

  return null;
}

export function MainConversationHost() {
  const { currentConversationId: threadId } = useWorkbenchNavigation();
  const current = useCurrentSession();

  if (!current.sessionId) return null;
  return (
    <SessionProvider sessionId={current.sessionId}>
      <MainConversationSessionHost threadId={threadId} />
    </SessionProvider>
  );
}

function MainConversationSessionHost({ threadId }: { threadId?: string }) {
  const current = useCurrentSession();
  const activeThreadId = current.sessionId;
  const nodeCount = useSessionState((snapshot) => snapshot.nodeKeys.length);
  const isEmpty = nodeCount === 0;
  const isThreadLoading = useSessionState((snapshot) => snapshot.isLoading);
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
    <WorkbenchConversationContent
      threadId={current.threadId ?? activeThreadId}
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
