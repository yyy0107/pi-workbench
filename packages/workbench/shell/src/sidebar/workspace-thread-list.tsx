"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
  ChevronRightIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";

import { collapsePanel } from "../elements/surfaces";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Skeleton } from "../ui/skeleton";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { useWorkbenchAgentThreadSnapshots } from "@workbench/agent-runtime-client/context";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
  type WorkspaceSummary,
} from "@workbench/agent-runtime-client/workspaces";
import { useAppearancePreferences } from "../appearance";
import { useWorkbenchNavigation } from "../navigation";
import { NewThreadButton } from "./new-thread-button";
import { DraftThreadListItem } from "./draft-thread-list-item";
import { RunningThreadIndicator } from "./running-thread-indicator";
import { sidebarItemIdAfterMove, type SidebarDropPosition } from "./sidebar-reorder";
import { groupSidebarThreads } from "./thread-list-groups";
import { WorkbenchThreadList } from "./thread-list";
import { useSidebarPointerReorder } from "./use-sidebar-pointer-reorder";

const WORKSPACE_PAGE_SIZE = 24;
const EMPTY_THREAD_IDS: readonly string[] = [];

interface WorkspaceDirectoryDragState {
  readonly enabled: boolean;
  readonly dragging: boolean;
  readonly dropPosition?: SidebarDropPosition;
  registerElement(element: HTMLElement | null): void;
  onPointerDown(event: PointerEvent<HTMLElement>): void;
  shouldSuppressClick(): boolean;
}

function useWorkspaceDirectoryReorder(
  directories: readonly WorkspaceSummary[],
  searchQuery: string,
) {
  const { collapsedWorkspaceIds } = useWorkspaceSelection();
  const { moveWorkspaceBefore, setWorkspaceCollapsed } = useWorkspaceCapabilities();
  const directoryIds = useMemo(() => directories.map((directory) => directory.id), [directories]);
  const enabled = directoryIds.length > 1 && searchQuery.trim().length === 0;
  const reorder = useSidebarPointerReorder({
    enabled,
    orderedIds: directoryIds,
    ignoreSelector: "[data-workspace-item-actions]",
    onMove: (sourceId, targetId, position) => {
      const sourceWasCollapsed = collapsedWorkspaceIds.includes(sourceId);
      const beforeWorkspaceId = sidebarItemIdAfterMove(directoryIds, sourceId, targetId, position);
      window.setTimeout(() => setWorkspaceCollapsed(sourceId, sourceWasCollapsed), 0);
      void moveWorkspaceBefore(sourceId, beforeWorkspaceId).catch((error) =>
        console.error("[workbench] failed to reorder workspace", error),
      );
    },
  });

  return {
    item(directoryId: string): WorkspaceDirectoryDragState {
      return {
        enabled,
        dragging: reorder.draggingId === directoryId,
        dropPosition:
          reorder.dropTarget?.itemId === directoryId ? reorder.dropTarget.position : undefined,
        registerElement: (element) => reorder.registerItem(directoryId, element),
        onPointerDown: (event) => reorder.prepareDragging(directoryId, event),
        shouldSuppressClick: () => reorder.shouldSuppressClick(directoryId),
      };
    },
  };
}

function useRemoveWorkspace(onNavigate?: () => void) {
  const aui = useAui();
  const navigation = useWorkbenchNavigation();
  const { removeWorkspace } = useWorkspaceCapabilities();

  return async (directoryId: string, active: boolean) => {
    try {
      await removeWorkspace(directoryId);
      if (!active) return;
      aui.threads.switchToNewThread();
      navigation.openHome();
      onNavigate?.();
    } catch (error) {
      console.error("[workbench] failed to remove workspace", error);
    }
  };
}

export function WorkbenchPinnedThreadList({
  searchQuery = "",
  onNavigate,
}: {
  searchQuery?: string;
  onNavigate?: () => void;
}) {
  const { isHome } = useWorkbenchNavigation();
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const threadStates = useWorkbenchAgentThreadSnapshots(threadIds);
  const workspaceFallbackThreadId =
    mainThreadId && !threadStates.get(mainThreadId)?.workspace?.id ? mainThreadId : undefined;
  const hasEmptyDraftNewThread = useAuiState(
    (state) =>
      state.threads.newThreadId !== undefined &&
      state.threads.mainThreadId === state.threads.newThreadId &&
      state.thread.messages.length === 0,
  );
  const {
    workspaces,
    activeWorkspaceId: activeDirectoryId,
    draftWorkspaceId: draftDirectoryId,
  } = useWorkspaceSelection();
  const threadGroups = useMemo(
    () =>
      groupSidebarThreads({
        threadIds,
        states: threadStates,
        mainThreadId: workspaceFallbackThreadId,
        draftWorkspaceId: draftDirectoryId,
      }),
    [draftDirectoryId, threadIds, threadStates, workspaceFallbackThreadId],
  );
  const hasPinnedThreads = threadGroups.pinnedThreadIds.length > 0;
  const { activateWorkspace: activateDirectory } = useWorkspaceCapabilities();
  const removeWorkspace = useRemoveWorkspace(onNavigate);
  const pinnedDirectories = useMemo(
    () => workspaces.filter((workspace) => workspace.pinned === true),
    [workspaces],
  );
  const directoryReorder = useWorkspaceDirectoryReorder(pinnedDirectories, searchQuery);

  return (
    <div className="flex flex-col gap-1">
      {hasPinnedThreads ? (
        <div className="flex flex-col gap-[2px] ps-6">
          <WorkbenchThreadList
            candidateThreadIds={threadGroups.pinnedThreadIds}
            pinnedOnly
            ignoreWorkspace
            showEmpty={false}
            searchQuery={searchQuery}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
      {pinnedDirectories.map((directory) => {
        const candidateThreadIds =
          threadGroups.threadIdsByWorkspace.get(directory.id) ?? EMPTY_THREAD_IDS;
        return (
          <WorkspaceDirectorySection
            key={directory.id}
            directory={directory}
            active={directory.id === activeDirectoryId}
            hasNewThread={directory.id === draftDirectoryId && hasEmptyDraftNewThread && isHome}
            onActivate={() => activateDirectory(directory.id)}
            onRemove={() => void removeWorkspace(directory.id, directory.id === activeDirectoryId)}
            searchQuery={searchQuery}
            candidateThreadIds={candidateThreadIds}
            hasRunningThread={threadGroups.runningWorkspaceIds.has(directory.id)}
            drag={directoryReorder.item(directory.id)}
            onNavigate={onNavigate}
          />
        );
      })}
    </div>
  );
}

export function WorkbenchWorkspaceThreadList({
  searchQuery = "",
  onNavigate,
}: {
  searchQuery?: string;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const { isHome } = useWorkbenchNavigation();
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const threadStates = useWorkbenchAgentThreadSnapshots(threadIds);
  const workspaceFallbackThreadId =
    mainThreadId && !threadStates.get(mainThreadId)?.workspace?.id ? mainThreadId : undefined;
  const hasEmptyDraftNewThread = useAuiState(
    (state) =>
      state.threads.newThreadId !== undefined &&
      state.threads.mainThreadId === state.threads.newThreadId &&
      state.thread.messages.length === 0,
  );
  const {
    workspaces: directories,
    activeWorkspaceId: activeDirectoryId,
    draftWorkspaceId: draftDirectoryId,
  } = useWorkspaceSelection();
  const { activateWorkspace: activateDirectory, destroyNewThread } = useWorkspaceCapabilities();
  const removeWorkspace = useRemoveWorkspace(onNavigate);
  const threadGroups = useMemo(
    () =>
      groupSidebarThreads({
        threadIds,
        states: threadStates,
        mainThreadId: workspaceFallbackThreadId,
        draftWorkspaceId: draftDirectoryId,
      }),
    [draftDirectoryId, threadIds, threadStates, workspaceFallbackThreadId],
  );
  const hasUngroupedThreads = threadGroups.ungroupedThreadIds.length > 0;
  const [visibleWorkspaceCount, setVisibleWorkspaceCount] = useState(WORKSPACE_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleDirectories = useMemo(
    () => directories.filter((directory) => directory.pinned !== true),
    [directories],
  );
  const directoryReorder = useWorkspaceDirectoryReorder(visibleDirectories, searchQuery);

  useEffect(() => {
    if (!isHome) destroyNewThread();
  }, [destroyNewThread, isHome]);

  useEffect(() => {
    const selectedIndex = Math.max(
      visibleDirectories.findIndex((directory) => directory.id === activeDirectoryId),
      visibleDirectories.findIndex((directory) => directory.id === draftDirectoryId),
    );
    if (selectedIndex < visibleWorkspaceCount) return;
    setVisibleWorkspaceCount(
      Math.min(
        visibleDirectories.length,
        Math.ceil((selectedIndex + 1) / WORKSPACE_PAGE_SIZE) * WORKSPACE_PAGE_SIZE,
      ),
    );
  }, [activeDirectoryId, draftDirectoryId, visibleDirectories, visibleWorkspaceCount]);

  const hasMoreWorkspaces = visibleWorkspaceCount < visibleDirectories.length;
  const loadingPlaceholderCount = Math.min(
    4,
    Math.max(0, visibleDirectories.length - visibleWorkspaceCount),
  );

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreWorkspaces) return;

    const root = target.closest<HTMLElement>("[data-workspace-scroll-container]");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisibleWorkspaceCount((count) =>
          Math.min(count + WORKSPACE_PAGE_SIZE, visibleDirectories.length),
        );
      },
      { root, rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreWorkspaces, visibleDirectories.length, visibleWorkspaceCount]);

  if (isLoading && directories.length === 0) {
    return <WorkbenchThreadListLoading />;
  }

  if (directories.length === 0 && !hasUngroupedThreads) {
    return (
      <p className="text-muted-foreground px-2 py-3 text-xs leading-relaxed">
        {t("workbench.sidebar.noWorkspaces")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {visibleDirectories.slice(0, visibleWorkspaceCount).map((directory) => {
        const candidateThreadIds =
          threadGroups.threadIdsByWorkspace.get(directory.id) ?? EMPTY_THREAD_IDS;
        return (
          <WorkspaceDirectorySection
            key={directory.id}
            directory={directory}
            active={directory.id === activeDirectoryId}
            hasNewThread={directory.id === draftDirectoryId && hasEmptyDraftNewThread && isHome}
            onActivate={() => activateDirectory(directory.id)}
            onRemove={() => void removeWorkspace(directory.id, directory.id === activeDirectoryId)}
            searchQuery={searchQuery}
            candidateThreadIds={candidateThreadIds}
            hasRunningThread={threadGroups.runningWorkspaceIds.has(directory.id)}
            drag={directoryReorder.item(directory.id)}
            onNavigate={onNavigate}
          />
        );
      })}
      {hasMoreWorkspaces ? (
        <div
          ref={loadMoreRef}
          role="status"
          aria-label={t("workbench.sidebar.loadingMoreWorkspaces")}
          className="flex flex-col gap-1"
        >
          {Array.from({ length: loadingPlaceholderCount }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ) : null}
      {hasUngroupedThreads ? (
        <section className="flex flex-col gap-0.5">
          <h3 className="text-muted-foreground px-2 py-1 text-xs font-medium">
            {t("workbench.sidebar.ungrouped")}
          </h3>
          <div className="flex flex-col gap-[2px] ps-6">
            <WorkbenchThreadList
              candidateThreadIds={threadGroups.ungroupedThreadIds}
              showEmpty={false}
              searchQuery={searchQuery}
              onNavigate={onNavigate}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function WorkspaceDirectorySection({
  directory,
  active,
  hasNewThread,
  onActivate,
  onRemove,
  searchQuery,
  candidateThreadIds,
  hasRunningThread,
  drag,
  onNavigate,
}: {
  directory: WorkspaceSummary;
  active: boolean;
  hasNewThread: boolean;
  onActivate(): void;
  onRemove(): void;
  searchQuery: string;
  candidateThreadIds: readonly string[];
  hasRunningThread: boolean;
  drag: WorkspaceDirectoryDragState;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const { runningIndicatorId } = useAppearancePreferences();
  const workspaceLabelId = useId();
  const workspaceActionId = useId();
  const workspaceStatusId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const { collapsedWorkspaceIds } = useWorkspaceSelection();
  const { openWorkspaceFolder, setWorkspacePinned, toggleWorkspaceCollapsed } =
    useWorkspaceCapabilities();
  const pinned = directory.pinned === true;
  const collapsed = collapsedWorkspaceIds.includes(directory.id);
  const expanded = !collapsed;
  const showRunningIndicator = collapsed && hasRunningThread;
  const expansionLabel = t(
    expanded ? "workbench.sidebar.collapseWorkspace" : "workbench.sidebar.expandWorkspace",
  );
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const showNewThread =
    hasNewThread &&
    (!normalizedSearchQuery ||
      t("workbench.sidebar.newThread").toLocaleLowerCase().includes(normalizedSearchQuery));
  const toggleExpanded = () => toggleWorkspaceCollapsed(directory.id);

  return (
    <Collapsible
      render={<section />}
      open={expanded}
      onOpenChange={(open) => {
        if (drag.shouldSuppressClick()) return;
        onActivate();
        if (open !== expanded) toggleExpanded();
      }}
      className="relative flex flex-col gap-0.5"
    >
      {drag.dropPosition ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute start-2 end-2 z-20 h-0.5 rounded-full bg-blue-500",
            drag.dropPosition === "before" ? "-top-px" : "-bottom-px",
          )}
        >
          <span className="absolute start-0 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
        </span>
      ) : null}
      <div
        data-workbench-selection-surface=""
        ref={drag.registerElement}
        className={cn(
          "group/workspace hover:bg-sidebar-accent focus-within:bg-sidebar-accent relative flex h-[var(--control-hit-touch)] w-full items-center rounded-lg px-1.5 transition-colors md:h-9",
          drag.enabled && "cursor-grab active:cursor-grabbing",
          drag.dragging && "cursor-grabbing",
        )}
        onPointerDown={drag.onPointerDown}
      >
        <CollapsibleTrigger
          type="button"
          aria-labelledby={`${workspaceLabelId} ${workspaceActionId}${showRunningIndicator ? ` ${workspaceStatusId}` : ""}`}
          className="focus-visible:ring-sidebar-ring absolute inset-0 rounded-lg outline-none focus-visible:ring-2"
          onClick={(event) => {
            if (!drag.shouldSuppressClick()) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />

        <div className="pointer-events-none relative size-[var(--sidebar-action-frame-size)] shrink-0">
          <FolderIcon
            className={cn(
              "absolute left-1/2 top-1/2 size-[var(--icon-size-md)] -translate-x-1/2 -translate-y-1/2 transition-opacity max-md:opacity-0 md:group-hover/workspace:opacity-0 md:group-has-[:focus-visible]/workspace:opacity-0",
              active && "text-blue-500",
            )}
          />
          <ChevronRightIcon
            className={cn(
              "absolute left-1/2 top-1/2 size-[var(--icon-size-md)] -translate-x-1/2 -translate-y-1/2 opacity-100 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none md:opacity-0 md:group-hover/workspace:opacity-100 md:group-has-[:focus-visible]/workspace:opacity-100",
              expanded && "rotate-90",
            )}
          />
        </div>

        <div
          id={workspaceLabelId}
          className="pointer-events-none flex min-w-0 flex-1 items-center py-0 ps-1 pe-[var(--sidebar-action-touch-reserved-space)] text-start text-sm font-medium md:pe-[var(--sidebar-action-pair-reserved-space)]"
        >
          <span className="translate-y-[var(--control-text-offset-y)] truncate leading-[var(--control-text-line-height)]">
            {directory.name}
          </span>
        </div>
        <span id={workspaceActionId} className="sr-only">
          {expansionLabel}
        </span>
        {showRunningIndicator ? (
          <span id={workspaceStatusId} className="sr-only">
            {t("workbench.sidebar.generating")}
          </span>
        ) : null}

        {showRunningIndicator ? (
          <RunningThreadIndicator
            id={runningIndicatorId}
            className={cn(
              "pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 opacity-100 transition-opacity duration-150 ease-out motion-reduce:transition-none md:flex md:group-hover/workspace:opacity-0 md:group-focus-within/workspace:opacity-0",
              menuOpen && "md:opacity-0",
            )}
          />
        ) : null}

        <div
          data-sidebar-actions=""
          data-sidebar-actions-mobile-touch=""
          data-workspace-item-actions=""
          className={cn(
            "absolute end-0 z-10 flex opacity-100 transition-opacity duration-150 ease-out motion-reduce:transition-none md:pointer-events-none md:opacity-0 md:group-hover/workspace:pointer-events-auto md:group-hover/workspace:opacity-100 md:group-focus-within/workspace:pointer-events-auto md:group-focus-within/workspace:opacity-100",
            menuOpen && "md:pointer-events-auto md:opacity-100",
          )}
        >
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("workbench.sidebar.workspaceOptions")}
                  className="text-muted-foreground hover:text-foreground focus-visible:text-foreground aria-expanded:text-foreground transition-colors duration-150"
                >
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={4}
              className="w-44 gap-0 p-1.5 duration-150 ease-out data-[side=bottom]:slide-in-from-top-1 data-open:zoom-in-100 data-closed:zoom-out-100 motion-reduce:animate-none"
            >
              <NewThreadButton
                workspaceId={directory.id}
                variant="menu"
                className="min-h-[var(--control-hit-touch)] md:min-h-8"
                onNavigate={() => {
                  setMenuOpen(false);
                  onNavigate?.();
                }}
              />
              <button
                type="button"
                className="hover:bg-accent focus-visible:bg-accent flex h-8 min-h-[var(--control-hit-touch)] w-full items-center gap-2 rounded-md px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-start text-sm leading-[var(--control-text-line-height)]! outline-none md:min-h-8"
                onClick={() => {
                  setMenuOpen(false);
                  void openWorkspaceFolder(directory.id).catch((error) =>
                    console.error("[workbench] failed to open workspace folder", error),
                  );
                }}
              >
                <FolderOpenIcon className="size-[var(--icon-size-md)]" />
                {t("workbench.sidebar.openWorkspaceFolder")}
              </button>
              <button
                type="button"
                className="hover:bg-accent focus-visible:bg-accent flex h-8 min-h-[var(--control-hit-touch)] w-full items-center gap-2 rounded-md px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-start text-sm leading-[var(--control-text-line-height)]! outline-none md:min-h-8"
                onClick={() => {
                  setMenuOpen(false);
                  void setWorkspacePinned(directory.id, !pinned).catch((error) =>
                    console.error("[workbench] failed to update pinned workspace", error),
                  );
                }}
              >
                {pinned ? (
                  <PinOffIcon className="size-[var(--icon-size-md)]" />
                ) : (
                  <PinIcon className="size-[var(--icon-size-md)]" />
                )}
                {t(pinned ? "workbench.sidebar.unpinWorkspace" : "workbench.sidebar.pinWorkspace")}
              </button>
              <button
                type="button"
                className="text-destructive hover:bg-accent hover:text-destructive focus-visible:bg-accent flex h-8 min-h-[var(--control-hit-touch)] w-full items-center gap-2 rounded-md px-2 pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-start text-sm leading-[var(--control-text-line-height)]! outline-none md:min-h-8"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
              >
                <FolderMinusIcon className="size-[var(--icon-size-md)]" />
                {t("workbench.sidebar.removeWorkspace")}
              </button>
            </PopoverContent>
          </Popover>

          <NewThreadButton
            workspaceId={directory.id}
            variant="icon"
            className="hidden md:inline-flex"
            onNavigate={onNavigate}
          />
        </div>
      </div>

      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className="flex flex-col gap-[2px] ps-6">
          {showNewThread ? (
            <DraftThreadListItem workspaceId={directory.id} onNavigate={onNavigate} />
          ) : null}
          <WorkbenchThreadList
            workspaceId={directory.id}
            candidateThreadIds={candidateThreadIds}
            showEmpty={!showNewThread && !normalizedSearchQuery}
            searchQuery={searchQuery}
            onNavigate={onNavigate}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function WorkbenchThreadListLoading() {
  return <div className="bg-muted mx-2 h-9 animate-pulse rounded-lg" />;
}
