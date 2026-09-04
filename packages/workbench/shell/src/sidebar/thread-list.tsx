"use client";

import { useMemo, useRef } from "react";

import { Skeleton } from "../ui/skeleton";
import { useI18n } from "../i18n";
import { useAgentRuntime, useCurrentSession, useThreadList } from "@workbench/agent-runtime-client";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";
import { resolveSidebarThreadWorkspaceId } from "../new-thread-policy";

import { WorkbenchThreadListItem } from "./thread-list-item";
import { sidebarItemIdAfterMove } from "./sidebar-reorder";
import { useThreadOrderStore } from "./thread-order-store";
import { useSidebarPointerReorder } from "./use-sidebar-pointer-reorder";
import { moveThreadId, resolveThreadOrder } from "./thread-sort";

const EMPTY_THREAD_ORDER: readonly string[] = [];

function ThreadListLoading() {
  const { t } = useI18n();

  return (
    <div aria-label={t("workbench.sidebar.loading")} className="flex flex-col gap-[2px] p-1">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function WorkbenchThreadList({
  workspaceId,
  candidateThreadIds,
  pinnedOnly = false,
  ignoreWorkspace = false,
  onNavigate,
  showEmpty = true,
  searchQuery = "",
}: {
  workspaceId?: string;
  candidateThreadIds?: readonly string[];
  pinnedOnly?: boolean;
  ignoreWorkspace?: boolean;
  onNavigate?: () => void;
  showEmpty?: boolean;
  searchQuery?: string;
}) {
  const { t } = useI18n();
  const runtime = useAgentRuntime();
  const threadActions = runtime.threadActions;
  const current = useCurrentSession();
  const { threads: threadItems, isLoading } = useThreadList();
  const threadIds = useMemo(() => threadItems.map((thread) => thread.threadId), [threadItems]);
  const itemsById = useMemo(
    () => new Map(threadItems.map((thread) => [thread.threadId, thread])),
    [threadItems],
  );
  const scopedCandidateThreadIds = candidateThreadIds ?? threadIds;
  const { draftWorkspaceId } = useWorkspaceSelection();
  const threadCount = threadItems.length;
  const isInitialLoading = isLoading && threadCount === 0;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const scopeThreadIds = useMemo(() => {
    return scopedCandidateThreadIds.filter((threadId) => {
      const thread = itemsById.get(threadId);
      if (!thread) return false;
      const isPinned = thread.isPinned;
      if (pinnedOnly ? !isPinned : isPinned) return false;

      return (
        ignoreWorkspace ||
        resolveSidebarThreadWorkspaceId({
          managedWorkspaceId: thread.workspace?.id,
          isMainThread: thread.threadId === current.threadId,
          draftWorkspaceId,
        }) === workspaceId
      );
    });
  }, [
    draftWorkspaceId,
    ignoreWorkspace,
    current.threadId,
    pinnedOnly,
    scopedCandidateThreadIds,
    itemsById,
    threadItems,
    workspaceId,
  ]);
  const visibleThreadIds = useMemo(() => {
    if (!normalizedSearchQuery) return scopeThreadIds;
    return scopeThreadIds.filter((threadId) => {
      const title = itemsById.get(threadId)?.title;
      return title?.toLocaleLowerCase().includes(normalizedSearchQuery);
    });
  }, [itemsById, normalizedSearchQuery, scopeThreadIds]);
  const hasThreads = visibleThreadIds.length > 0;
  const orderScope = pinnedOnly ? "pinned" : workspaceId ? `workspace:${workspaceId}` : "ungrouped";
  const sourceOrderIsCanonical =
    workspaceId !== undefined && !pinnedOnly && threadActions.moveWithinWorkspace !== undefined;
  const storedManualOrder = useThreadOrderStore(
    (state) => state.manualOrderByScope[orderScope] ?? EMPTY_THREAD_ORDER,
  );
  const setManualOrder = useThreadOrderStore((state) => state.setManualOrder);
  const createdAtByThreadId = useMemo(
    () => new Map(scopeThreadIds.map((threadId) => [threadId, itemsById.get(threadId)?.createdAt])),
    [itemsById, scopeThreadIds],
  );
  const resolvedScopeThreadIds = useMemo(
    () =>
      resolveThreadOrder(
        scopeThreadIds,
        createdAtByThreadId,
        storedManualOrder,
        sourceOrderIsCanonical,
      ),
    [createdAtByThreadId, scopeThreadIds, sourceOrderIsCanonical, storedManualOrder],
  );
  const sortedThreadIds = useMemo(() => {
    if (!normalizedSearchQuery) return resolvedScopeThreadIds;
    const visibleIds = new Set(visibleThreadIds);
    return resolvedScopeThreadIds.filter((threadId) => visibleIds.has(threadId));
  }, [normalizedSearchQuery, resolvedScopeThreadIds, visibleThreadIds]);
  const workspaceIdByThreadId = useMemo(
    () =>
      new Map(
        sortedThreadIds.map((threadId) => [
          threadId,
          resolveSidebarThreadWorkspaceId({
            managedWorkspaceId: itemsById.get(threadId)?.workspace?.id,
            isMainThread: threadId === current.threadId,
            draftWorkspaceId,
          }),
        ]),
      ),
    [current.threadId, draftWorkspaceId, itemsById, sortedThreadIds],
  );
  const dragOrderContextRef = useRef({ orderScope, resolvedScopeThreadIds });
  const dragEnabled = sortedThreadIds.length > 1;
  dragOrderContextRef.current = { orderScope, resolvedScopeThreadIds };
  const {
    draggingId: draggedThreadId,
    dropTarget,
    prepareDragging,
    registerItem,
    shouldSuppressClick,
  } = useSidebarPointerReorder({
    enabled: dragEnabled,
    orderedIds: sortedThreadIds,
    ignoreSelector: "[data-thread-item-actions]",
    onMove: (sourceThreadId, targetThreadId, position) => {
      const { orderScope: currentScope, resolvedScopeThreadIds } = dragOrderContextRef.current;
      if (workspaceId && !pinnedOnly && threadActions.moveWithinWorkspace) {
        const beforeSessionId = sidebarItemIdAfterMove(
          resolvedScopeThreadIds,
          sourceThreadId,
          targetThreadId,
          position,
        );
        void threadActions
          .moveWithinWorkspace({
            workspaceId,
            threadId: sourceThreadId,
            ...(beforeSessionId === undefined ? {} : { beforeThreadId: beforeSessionId }),
          })
          .catch((error) => {
            console.error("[workbench] failed to persist conversation order", error);
          });
        return;
      }

      setManualOrder(
        currentScope,
        moveThreadId(resolvedScopeThreadIds, sourceThreadId, targetThreadId, position),
      );
    },
  });
  return (
    <div className="flex min-h-0 flex-col gap-[2px]">
      {isInitialLoading ? <ThreadListLoading /> : null}

      {!isInitialLoading
        ? sortedThreadIds.map((threadId) => {
            const thread = itemsById.get(threadId);
            return thread ? (
              <WorkbenchThreadListItem
                key={threadId}
                thread={thread}
                workspaceId={workspaceIdByThreadId.get(threadId) ?? workspaceId}
                dragEnabled={dragEnabled}
                dragging={draggedThreadId === threadId}
                dropPosition={dropTarget?.itemId === threadId ? dropTarget.position : undefined}
                registerDragElement={(element) => registerItem(threadId, element)}
                onPointerDown={(event) => prepareDragging(threadId, event)}
                shouldSuppressNavigation={() => shouldSuppressClick(threadId)}
                onNavigate={onNavigate}
              />
            ) : null;
          })
        : null}

      {showEmpty && !isInitialLoading && !hasThreads ? (
        <p className="text-muted-foreground px-2 py-2 text-xs leading-relaxed">
          {t(
            normalizedSearchQuery ? "workbench.sidebar.noSearchResults" : "workbench.sidebar.empty",
          )}
        </p>
      ) : null}
    </div>
  );
}
