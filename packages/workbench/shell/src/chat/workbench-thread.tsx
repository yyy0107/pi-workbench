"use client";

import { useLayoutEffect, useRef } from "react";
import {
  SessionProvider,
  useAgentRuntime,
  useCurrentSession,
  useSessionState,
  useThreadList,
} from "@workbench/agent-runtime-client";

import { resolvePromotedThreadRouteId, shouldProjectNewThreadRoute } from "../new-thread-policy";
import { useWorkbenchNavigation } from "../navigation";
import { useNewThreadLayout } from "../layout/new-thread-layout";

import { WorkbenchComposer } from "./workbench-composer";
import { WorkbenchConversationContent } from "./workbench-conversation";

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
  const { dockComposerWhenEmpty } = useNewThreadLayout();
  const activeThreadId = current.sessionId;

  return (
    <WorkbenchConversationContent
      threadId={current.threadId ?? activeThreadId}
      hostContent={<ThreadRouteSync threadId={threadId} />}
      emptyComposer={<WorkbenchComposer />}
      composerDock={<WorkbenchComposer />}
      dockComposerWhenEmpty={current.isNewThread && dockComposerWhenEmpty}
      showHistoryLoading={Boolean(threadId)}
      autoScroll
    />
  );
}

/** Backward-compatible page entry; MainConversationHost owns all MainView-only behavior. */
export function WorkbenchThread() {
  return <MainConversationHost />;
}
