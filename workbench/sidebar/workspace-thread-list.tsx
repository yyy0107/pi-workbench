"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
  ChevronRightIcon,
  FolderIcon,
  FolderMinusIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { collapsePanel } from "@/components/elements/surfaces";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePiThreadStates } from "@/runtime/pi/client/runtime/context";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
  type WorkspaceSummary,
} from "@/services/workspace-selection-service";
import { resolveSidebarThreadWorkspaceId } from "@/workbench/workspaces/new-thread-policy";

import { NewThreadButton } from "./new-thread-button";
import { DraftThreadListItem } from "./draft-thread-list-item";
import { sidebarItemIdAfterMove, type SidebarDropPosition } from "./sidebar-reorder";
import { WorkbenchThreadList } from "./thread-list";
import { useSidebarPointerReorder } from "./use-sidebar-pointer-reorder";

const WORKSPACE_PAGE_SIZE = 24;

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
  const router = useRouter();
  const { removeWorkspace } = useWorkspaceCapabilities();

  return async (directoryId: string, active: boolean) => {
    try {
      await removeWorkspace(directoryId);
      if (!active) return;
      aui.threads.switchToNewThread();
      router.push("/");
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
  const pathname = usePathname();
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const piThreadStates = usePiThreadStates(threadIds);
  const hasPinnedThreads = useMemo(
    () => threadIds.some((threadId) => piThreadStates.get(threadId)?.metadata.pinned === true),
    [piThreadStates, threadIds],
  );
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
            pinnedOnly
            ignoreWorkspace
            showEmpty={false}
            searchQuery={searchQuery}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
      {pinnedDirectories.map((directory) => (
        <WorkspaceDirectorySection
          key={directory.id}
          directory={directory}
          active={directory.id === activeDirectoryId}
          hasNewThread={
            directory.id === draftDirectoryId && hasEmptyDraftNewThread && pathname === "/"
          }
          onActivate={() => activateDirectory(directory.id)}
          onRemove={() => void removeWorkspace(directory.id, directory.id === activeDirectoryId)}
          searchQuery={searchQuery}
          drag={directoryReorder.item(directory.id)}
          onNavigate={onNavigate}
        />
      ))}
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
  const pathname = usePathname();
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const piThreadStates = usePiThreadStates(threadIds);
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
  const hasUngroupedThreads = useMemo(
    () =>
      threadIds.some((threadId) => {
        const metadata = piThreadStates.get(threadId)?.metadata;
        if (metadata?.pinned === true) return false;
        return (
          resolveSidebarThreadWorkspaceId({
            customWorkspaceId: undefined,
            managedWorkspaceId: metadata?.workspace?.id,
            isMainThread: threadId === mainThreadId,
            draftWorkspaceId: draftDirectoryId,
          }) === undefined
        );
      }),
    [draftDirectoryId, mainThreadId, piThreadStates, threadIds],
  );
  const [visibleWorkspaceCount, setVisibleWorkspaceCount] = useState(WORKSPACE_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleDirectories = useMemo(
    () => directories.filter((directory) => directory.pinned !== true),
    [directories],
  );
  const directoryReorder = useWorkspaceDirectoryReorder(visibleDirectories, searchQuery);

  useEffect(() => {
    if (pathname !== "/") destroyNewThread();
  }, [destroyNewThread, pathname]);

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
        return (
          <WorkspaceDirectorySection
            key={directory.id}
            directory={directory}
            active={directory.id === activeDirectoryId}
            hasNewThread={
              directory.id === draftDirectoryId && hasEmptyDraftNewThread && pathname === "/"
            }
            onActivate={() => activateDirectory(directory.id)}
            onRemove={() => void removeWorkspace(directory.id, directory.id === activeDirectoryId)}
            searchQuery={searchQuery}
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
  drag,
  onNavigate,
}: {
  directory: WorkspaceSummary;
  active: boolean;
  hasNewThread: boolean;
  onActivate(): void;
  onRemove(): void;
  searchQuery: string;
  drag: WorkspaceDirectoryDragState;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const workspaceLabelId = useId();
  const workspaceActionId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const { collapsedWorkspaceIds } = useWorkspaceSelection();
  const { setWorkspacePinned, toggleWorkspaceCollapsed } = useWorkspaceCapabilities();
  const pinned = directory.pinned === true;
  const collapsed = collapsedWorkspaceIds.includes(directory.id);
  const expanded = !collapsed;
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
      className={cn(
        "relative flex flex-col gap-0.5 transition-opacity",
        drag.dragging && "opacity-40",
      )}
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
          "group/workspace hover:bg-sidebar-accent focus-within:bg-sidebar-accent relative flex h-9 w-full items-center rounded-lg px-1.5 transition-colors",
          drag.enabled && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={drag.onPointerDown}
      >
        <CollapsibleTrigger
          type="button"
          aria-labelledby={`${workspaceLabelId} ${workspaceActionId}`}
          className="focus-visible:ring-sidebar-ring absolute inset-0 rounded-lg outline-none focus-visible:ring-2"
          onClick={(event) => {
            if (!drag.shouldSuppressClick()) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />

        <div className="pointer-events-none relative size-7 shrink-0">
          <FolderIcon
            className={cn(
              "absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 transition-opacity max-md:opacity-0 md:group-hover/workspace:opacity-0 md:group-has-[:focus-visible]/workspace:opacity-0",
              active && "text-blue-500",
            )}
          />
          <ChevronRightIcon
            className={cn(
              "absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 opacity-100 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none md:opacity-0 md:group-hover/workspace:opacity-100 md:group-has-[:focus-visible]/workspace:opacity-100",
              expanded && "rotate-90",
            )}
          />
        </div>

        <div
          id={workspaceLabelId}
          className="pointer-events-none min-w-0 flex-1 truncate py-0 ps-1 pe-14 text-start text-sm font-medium"
        >
          {directory.name}
        </div>
        <span id={workspaceActionId} className="sr-only">
          {expansionLabel}
        </span>

        <div
          data-workspace-item-actions=""
          className={cn(
            "absolute end-0 z-10 flex items-center opacity-100 transition-opacity duration-150 ease-out motion-reduce:transition-none md:pointer-events-none md:opacity-0 md:group-hover/workspace:pointer-events-auto md:group-hover/workspace:opacity-100 md:group-focus-within/workspace:pointer-events-auto md:group-focus-within/workspace:opacity-100",
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
                  <MoreHorizontalIcon className="size-4" />
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
                onNavigate={() => {
                  setMenuOpen(false);
                  onNavigate?.();
                }}
              />
              <button
                type="button"
                className="hover:bg-accent focus-visible:bg-accent flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm outline-none"
                onClick={() => {
                  setMenuOpen(false);
                  void setWorkspacePinned(directory.id, !pinned).catch((error) =>
                    console.error("[workbench] failed to update pinned workspace", error),
                  );
                }}
              >
                {pinned ? <PinOffIcon className="size-4" /> : <PinIcon className="size-4" />}
                {t(pinned ? "workbench.sidebar.unpinWorkspace" : "workbench.sidebar.pinWorkspace")}
              </button>
              <button
                type="button"
                className="text-destructive hover:bg-accent hover:text-destructive focus-visible:bg-accent flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm outline-none"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
              >
                <FolderMinusIcon className="size-4" />
                {t("workbench.sidebar.removeWorkspace")}
              </button>
            </PopoverContent>
          </Popover>

          <NewThreadButton workspaceId={directory.id} variant="icon" onNavigate={onNavigate} />
        </div>
      </div>

      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className="flex flex-col gap-[2px] ps-6">
          {showNewThread ? (
            <DraftThreadListItem workspaceId={directory.id} onNavigate={onNavigate} />
          ) : null}
          <WorkbenchThreadList
            workspaceId={directory.id}
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
