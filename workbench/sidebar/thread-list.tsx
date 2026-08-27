"use client";

import { createContext, useContext, useMemo, useRef, type PointerEvent } from "react";
import { ThreadListPrimitive, useAuiState } from "@assistant-ui/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import {
  useWorkbenchAgentThreadActions,
  useWorkbenchAgentThreadSnapshots,
} from "@/runtime/assistant-ui/agent-runtime-context";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";
import { resolveSidebarThreadWorkspaceId } from "@/workbench/workspaces/new-thread-policy";

import { WorkbenchThreadListItem } from "./thread-list-item";
import { indexVisibleThreads } from "./thread-list-index";
import { sidebarItemIdAfterMove } from "./sidebar-reorder";
import { useThreadOrderStore } from "./thread-order-store";
import { useSidebarPointerReorder } from "./use-sidebar-pointer-reorder";
import { moveThreadId, resolveThreadOrder, type ThreadDropPosition } from "./thread-sort";

const EMPTY_THREAD_ORDER: readonly string[] = [];

interface ThreadItemRenderContextValue {
  readonly workspaceId?: string;
  readonly workspaceIdByThreadId: ReadonlyMap<string, string | undefined>;
  readonly dragEnabled: boolean;
  readonly draggedThreadId?: string;
  readonly dropTarget?: { readonly itemId: string; readonly position: ThreadDropPosition };
  readonly registerItem: (threadId: string, element: HTMLElement | null) => void;
  readonly prepareDragging: (threadId: string, event: PointerEvent<HTMLElement>) => void;
  readonly shouldSuppressClick: (threadId: string) => boolean;
  readonly onNavigate?: () => void;
}

const ThreadItemRenderContext = createContext<ThreadItemRenderContextValue | null>(null);

function ScopedWorkbenchThreadListItem() {
  const context = useContext(ThreadItemRenderContext);
  const threadId = useAuiState((state) => state.threadListItem.id);
  if (!context) throw new Error("ThreadItemRenderContext is missing");
  const workspaceId = context.workspaceIdByThreadId.get(threadId) ?? context.workspaceId;

  return (
    <WorkbenchThreadListItem
      workspaceId={workspaceId}
      dragEnabled={context.dragEnabled}
      dragging={context.draggedThreadId === threadId}
      dropPosition={
        context.dropTarget?.itemId === threadId ? context.dropTarget.position : undefined
      }
      registerDragElement={(element) => context.registerItem(threadId, element)}
      onPointerDown={(event) => context.prepareDragging(threadId, event)}
      shouldSuppressNavigation={() => context.shouldSuppressClick(threadId)}
      onNavigate={context.onNavigate}
    />
  );
}

const SCOPED_THREAD_ITEM_COMPONENTS = { ThreadListItem: ScopedWorkbenchThreadListItem };

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
  showLoadMore = false,
  showEmpty = true,
  searchQuery = "",
}: {
  workspaceId?: string;
  candidateThreadIds?: readonly string[];
  pinnedOnly?: boolean;
  ignoreWorkspace?: boolean;
  onNavigate?: () => void;
  showLoadMore?: boolean;
  showEmpty?: boolean;
  searchQuery?: string;
}) {
  const { t } = useI18n();
  const threadActions = useWorkbenchAgentThreadActions();
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const scopedCandidateThreadIds = candidateThreadIds ?? threadIds;
  const threadStates = useWorkbenchAgentThreadSnapshots(scopedCandidateThreadIds);
  const { draftWorkspaceId } = useWorkspaceSelection();
  const workspaceFallbackThreadId =
    mainThreadId && !threadStates.get(mainThreadId)?.workspace?.id ? mainThreadId : undefined;
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const threadCount = useAuiState(
    (state) => state.threads.threadIds.length + state.threads.archivedThreadIds.length,
  );
  const isInitialLoading = isLoading && threadCount === 0;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const scopeThreadIds = useMemo(() => {
    const itemsById = new Map(threadItems.map((thread) => [thread.id, thread]));

    return scopedCandidateThreadIds.filter((threadId) => {
      const thread = itemsById.get(threadId);
      if (!thread) return false;
      const threadState = threadStates.get(threadId);
      const isPinned = threadState?.isPinned === true;
      if (pinnedOnly ? !isPinned : isPinned) return false;

      return (
        ignoreWorkspace ||
        resolveSidebarThreadWorkspaceId({
          customWorkspaceId: undefined,
          managedWorkspaceId: threadState?.workspace?.id,
          isMainThread: thread.id === workspaceFallbackThreadId,
          draftWorkspaceId,
        }) === workspaceId
      );
    });
  }, [
    draftWorkspaceId,
    ignoreWorkspace,
    threadStates,
    pinnedOnly,
    scopedCandidateThreadIds,
    threadItems,
    workspaceFallbackThreadId,
    workspaceId,
  ]);
  const visibleThreadIds = useMemo(() => {
    if (!normalizedSearchQuery) return scopeThreadIds;
    const itemsById = new Map(threadItems.map((thread) => [thread.id, thread]));
    return scopeThreadIds.filter((threadId) => {
      const title = threadStates.get(threadId)?.title ?? itemsById.get(threadId)?.title;
      return title?.toLocaleLowerCase().includes(normalizedSearchQuery);
    });
  }, [normalizedSearchQuery, scopeThreadIds, threadItems, threadStates]);
  const hasThreads = visibleThreadIds.length > 0;
  const hasMore = useAuiState((state) => state.threads.hasMore);
  const orderScope = pinnedOnly ? "pinned" : workspaceId ? `workspace:${workspaceId}` : "ungrouped";
  const storedManualOrder = useThreadOrderStore(
    (state) => state.manualOrderByScope[orderScope] ?? EMPTY_THREAD_ORDER,
  );
  const setManualOrder = useThreadOrderStore((state) => state.setManualOrder);
  const createdAtByThreadId = useMemo(
    () =>
      new Map(scopeThreadIds.map((threadId) => [threadId, threadStates.get(threadId)?.createdAt])),
    [scopeThreadIds, threadStates],
  );
  const resolvedScopeThreadIds = useMemo(
    () => resolveThreadOrder(scopeThreadIds, createdAtByThreadId, storedManualOrder),
    [createdAtByThreadId, scopeThreadIds, storedManualOrder],
  );
  const sortedThreadIds = useMemo(() => {
    if (!normalizedSearchQuery) return resolvedScopeThreadIds;
    const visibleIds = new Set(visibleThreadIds);
    return resolvedScopeThreadIds.filter((threadId) => visibleIds.has(threadId));
  }, [normalizedSearchQuery, resolvedScopeThreadIds, visibleThreadIds]);
  const indexedThreads = useMemo(
    () => indexVisibleThreads(threadIds, sortedThreadIds),
    [sortedThreadIds, threadIds],
  );
  const workspaceIdByThreadId = useMemo(
    () =>
      new Map(
        sortedThreadIds.map((threadId) => [
          threadId,
          resolveSidebarThreadWorkspaceId({
            customWorkspaceId: undefined,
            managedWorkspaceId: threadStates.get(threadId)?.workspace?.id,
            isMainThread: threadId === workspaceFallbackThreadId,
            draftWorkspaceId,
          }),
        ]),
      ),
    [draftWorkspaceId, sortedThreadIds, threadStates, workspaceFallbackThreadId],
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
      const nextOrder = moveThreadId(
        resolvedScopeThreadIds,
        sourceThreadId,
        targetThreadId,
        position,
      );
      setManualOrder(currentScope, nextOrder);

      if (!workspaceId || pinnedOnly || !threadActions.moveWithinWorkspace) return;
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
          setManualOrder(currentScope, resolvedScopeThreadIds);
          console.error("[workbench] failed to persist conversation order", error);
        });
    },
  });
  const threadItemRenderContext = useMemo<ThreadItemRenderContextValue>(
    () => ({
      ...(workspaceId === undefined ? {} : { workspaceId }),
      workspaceIdByThreadId,
      dragEnabled,
      ...(draggedThreadId === undefined ? {} : { draggedThreadId }),
      ...(dropTarget === undefined ? {} : { dropTarget }),
      registerItem,
      prepareDragging,
      shouldSuppressClick,
      ...(onNavigate === undefined ? {} : { onNavigate }),
    }),
    [
      dragEnabled,
      draggedThreadId,
      dropTarget,
      onNavigate,
      prepareDragging,
      registerItem,
      shouldSuppressClick,
      workspaceId,
      workspaceIdByThreadId,
    ],
  );

  return (
    <ThreadListPrimitive.Root className="flex min-h-0 flex-col gap-[2px]">
      {isInitialLoading ? <ThreadListLoading /> : null}

      {!isInitialLoading ? (
        <ThreadItemRenderContext.Provider value={threadItemRenderContext}>
          {indexedThreads.map(({ threadId, index }) => (
            <ThreadListPrimitive.ItemByIndex
              key={threadId}
              index={index}
              components={SCOPED_THREAD_ITEM_COMPONENTS}
            />
          ))}
        </ThreadItemRenderContext.Provider>
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
