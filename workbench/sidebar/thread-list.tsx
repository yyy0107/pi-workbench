"use client";

import { useMemo, useRef } from "react";
import { ThreadListPrimitive, useAuiState } from "@assistant-ui/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { usePiSessionManager } from "@/runtime/pi/client/runtime/context";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";
import { resolveSidebarThreadWorkspaceId } from "@/workbench/workspaces/new-thread-policy";

import { WorkbenchThreadListItem } from "./thread-list-item";
import { useThreadOrderStore } from "./thread-order-store";
import { useSidebarPointerReorder } from "./use-sidebar-pointer-reorder";
import { moveThreadId, resolveThreadOrder, type ThreadSortMode } from "./thread-sort";

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
  pinnedOnly = false,
  ignoreWorkspace = false,
  onNavigate,
  showLoadMore = false,
  showEmpty = true,
  searchQuery = "",
  sortMode = "manual",
  sortRevision = 0,
}: {
  workspaceId?: string;
  pinnedOnly?: boolean;
  ignoreWorkspace?: boolean;
  onNavigate?: () => void;
  showLoadMore?: boolean;
  showEmpty?: boolean;
  searchQuery?: string;
  sortMode?: ThreadSortMode;
  sortRevision?: number;
}) {
  const { t } = useI18n();
  const manager = usePiSessionManager();
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const { draftWorkspaceId } = useWorkspaceSelection();
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const threadCount = useAuiState(
    (state) => state.threads.threadIds.length + state.threads.archivedThreadIds.length,
  );
  const isInitialLoading = isLoading && threadCount === 0;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const scopeThreadIds = useMemo(() => {
    const itemsById = new Map(threadItems.map((thread) => [thread.id, thread]));

    return threadIds.filter((threadId) => {
      const thread = itemsById.get(threadId);
      if (!thread) return false;
      const isPinned = thread.custom?.piPinned === true;
      if (pinnedOnly ? !isPinned : isPinned) return false;

      return (
        ignoreWorkspace ||
        resolveSidebarThreadWorkspaceId({
          customWorkspaceId: thread.custom?.piWorkspaceId,
          managedWorkspaceId: manager.getThreadCustom(thread.id)?.piWorkspaceId,
          isMainThread: thread.id === mainThreadId,
          draftWorkspaceId,
        }) === workspaceId
      );
    });
  }, [
    draftWorkspaceId,
    ignoreWorkspace,
    mainThreadId,
    manager,
    pinnedOnly,
    threadIds,
    threadItems,
    workspaceId,
  ]);
  const visibleThreadIds = useMemo(() => {
    if (!normalizedSearchQuery) return scopeThreadIds;
    const itemsById = new Map(threadItems.map((thread) => [thread.id, thread]));
    return scopeThreadIds.filter((threadId) =>
      itemsById.get(threadId)?.title?.toLocaleLowerCase().includes(normalizedSearchQuery),
    );
  }, [normalizedSearchQuery, scopeThreadIds, threadItems]);
  const hasThreads = visibleThreadIds.length > 0;
  const hasMore = useAuiState((state) => state.threads.hasMore);
  const orderScope = pinnedOnly ? "pinned" : workspaceId ? `workspace:${workspaceId}` : "ungrouped";
  const storedManualOrder = useThreadOrderStore(
    (state) => state.manualOrderByScope[orderScope] ?? EMPTY_THREAD_ORDER,
  );
  const storedManualOrderRevision = useThreadOrderStore(
    (state) => state.manualOrderRevisionByScope[orderScope],
  );
  const setManualOrder = useThreadOrderStore((state) => state.setManualOrder);
  const resolvedScopeThreadIds = useMemo(
    () =>
      resolveThreadOrder({
        threadIds: scopeThreadIds,
        threadItems,
        mode: sortMode,
        activeThreadId: mainThreadId,
        storedManualOrder,
        storedManualOrderRevision,
        sortRevision,
      }),
    [
      mainThreadId,
      scopeThreadIds,
      threadItems,
      sortMode,
      sortRevision,
      storedManualOrder,
      storedManualOrderRevision,
    ],
  );
  const sortedThreadIds = useMemo(() => {
    if (!normalizedSearchQuery) return resolvedScopeThreadIds;
    const visibleIds = new Set(visibleThreadIds);
    return resolvedScopeThreadIds.filter((threadId) => visibleIds.has(threadId));
  }, [normalizedSearchQuery, resolvedScopeThreadIds, visibleThreadIds]);
  const threadOrder = useMemo(
    () => new Map(sortedThreadIds.map((threadId, index) => [threadId, index])),
    [sortedThreadIds],
  );
  const dragOrderContextRef = useRef({ orderScope, resolvedScopeThreadIds, sortRevision });
  const dragEnabled = sortedThreadIds.length > 1;
  dragOrderContextRef.current = { orderScope, resolvedScopeThreadIds, sortRevision };
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
      const {
        orderScope: currentScope,
        resolvedScopeThreadIds,
        sortRevision,
      } = dragOrderContextRef.current;
      setManualOrder(
        currentScope,
        moveThreadId(resolvedScopeThreadIds, sourceThreadId, targetThreadId, position),
        sortRevision,
      );
    },
  });

  return (
    <ThreadListPrimitive.Root className="flex min-h-0 flex-col gap-[2px]">
      {isInitialLoading ? <ThreadListLoading /> : null}

      {!isInitialLoading ? (
        <ThreadListPrimitive.Items>
          {({ threadListItem }) => {
            const isPinned = threadListItem.custom?.piPinned === true;
            if (pinnedOnly ? !isPinned : isPinned) return null;
            if (
              normalizedSearchQuery &&
              !threadListItem.title?.toLocaleLowerCase().includes(normalizedSearchQuery)
            ) {
              return null;
            }

            const threadWorkspaceId = resolveSidebarThreadWorkspaceId({
              customWorkspaceId: threadListItem.custom?.piWorkspaceId,
              managedWorkspaceId: manager.getThreadCustom(threadListItem.id)?.piWorkspaceId,
              isMainThread: threadListItem.id === mainThreadId,
              draftWorkspaceId,
            });
            if (!ignoreWorkspace && threadWorkspaceId !== workspaceId) return null;

            return (
              <WorkbenchThreadListItem
                workspaceId={threadWorkspaceId}
                sortOrder={threadOrder.get(threadListItem.id)}
                dragEnabled={dragEnabled}
                dragging={draggedThreadId === threadListItem.id}
                dropPosition={
                  dropTarget?.itemId === threadListItem.id ? dropTarget.position : undefined
                }
                registerDragElement={(element) => registerItem(threadListItem.id, element)}
                onPointerDown={(event) => prepareDragging(threadListItem.id, event)}
                shouldSuppressNavigation={() => shouldSuppressClick(threadListItem.id)}
                onNavigate={onNavigate}
              />
            );
          }}
        </ThreadListPrimitive.Items>
      ) : null}

      {showEmpty && !isInitialLoading && !hasThreads ? (
        <p className="text-muted-foreground px-2 py-2 text-xs leading-relaxed">
          {t(
            normalizedSearchQuery ? "workbench.sidebar.noSearchResults" : "workbench.sidebar.empty",
          )}
        </p>
      ) : null}

      {showLoadMore && hasMore ? (
        <ThreadListPrimitive.LoadMore
          render={<Button type="button" variant="ghost" size="sm" className="mt-2 w-full" />}
        >
          {t("workbench.sidebar.loadMore")}
        </ThreadListPrimitive.LoadMore>
      ) : null}
    </ThreadListPrimitive.Root>
  );
}
