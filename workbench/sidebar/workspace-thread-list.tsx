"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePiSessionManager, usePiWorkspaces } from "@/runtime/pi/client/runtime/context";
import { resolveSidebarThreadWorkspaceId } from "@/workbench/workspaces/new-thread-policy";
import {
  useWorkspaceDirectoryStore,
  type WorkspaceDirectory,
} from "@/workbench/workspaces/workspace-directory-store";

import { NewThreadButton } from "./new-thread-button";
import { DraftThreadListItem } from "./draft-thread-list-item";
import { WorkbenchThreadList } from "./thread-list";

const WORKSPACE_PAGE_SIZE = 24;

export function WorkbenchPinnedThreadList({ onNavigate }: { onNavigate?: () => void }) {
  const hasPinnedThreads = useAuiState((state) =>
    state.threads.threadIds.some((threadId) => {
      const thread = state.threads.threadItems.find((item) => item.id === threadId);
      return thread?.custom?.piPinned === true;
    }),
  );
  const directories = useWorkspaceDirectoryStore((state) => state.directories);
  const pinnedDirectoryIds = useWorkspaceDirectoryStore((state) => state.pinnedDirectoryIds);
  const pinnedDirectories = useMemo(
    () =>
      pinnedDirectoryIds
        .map((directoryId) => directories.find((directory) => directory.id === directoryId))
        .filter((directory): directory is WorkspaceDirectory => directory !== undefined),
    [directories, pinnedDirectoryIds],
  );

  return (
    <div className="flex flex-col gap-1">
      {hasPinnedThreads ? (
        <div className="flex flex-col gap-[2px] ps-6">
          <WorkbenchThreadList
            pinnedOnly
            ignoreWorkspace
            showEmpty={false}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
      {pinnedDirectories.map((directory) => (
        <PinnedWorkspaceSection key={directory.id} directory={directory} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function PinnedWorkspaceSection({
  directory,
  onNavigate,
}: {
  directory: WorkspaceDirectory;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const workspaceLabelId = useId();
  const workspaceActionId = useId();
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const manager = usePiSessionManager();
  const expansionLabel = t(
    expanded ? "workbench.sidebar.collapseWorkspace" : "workbench.sidebar.expandWorkspace",
  );

  return (
    <section className="flex flex-col gap-0.5">
      <div
        data-workbench-selection-surface=""
        className="group/pinned-workspace hover:bg-sidebar-accent focus-within:bg-sidebar-accent relative flex h-9 w-full items-center rounded-lg px-1.5 transition-colors"
      >
        <button
          type="button"
          aria-labelledby={`${workspaceLabelId} ${workspaceActionId}`}
          aria-expanded={expanded}
          className="focus-visible:ring-sidebar-ring absolute inset-0 rounded-lg outline-none focus-visible:ring-2"
          onClick={() => setExpanded((value) => !value)}
        />

        <div className="pointer-events-none relative size-7 shrink-0">
          <FolderIcon className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 transition-opacity max-md:opacity-0 md:group-hover/pinned-workspace:opacity-0 md:group-has-[:focus-visible]/pinned-workspace:opacity-0" />
          <ChevronRightIcon
            className={cn(
              "absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 opacity-100 transition-[transform,opacity] md:opacity-0 md:group-hover/pinned-workspace:opacity-100 md:group-has-[:focus-visible]/pinned-workspace:opacity-100",
              expanded && "rotate-90",
            )}
          />
        </div>

        <div
          id={workspaceLabelId}
          className="pointer-events-none min-w-0 flex-1 truncate ps-1 pe-8 text-start text-sm font-medium"
        >
          {directory.name}
        </div>
        <span id={workspaceActionId} className="sr-only">
          {expansionLabel}
        </span>

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("workbench.sidebar.workspaceOptions")}
                className={cn(
                  "aui-button-icon text-muted-foreground hover:text-foreground focus-visible:text-foreground aria-expanded:text-foreground absolute end-1 z-10 size-7 p-1 opacity-100 active:scale-90 md:opacity-0 md:group-hover/pinned-workspace:opacity-100 md:group-focus-within/pinned-workspace:opacity-100",
                  menuOpen && "md:opacity-100",
                )}
              >
                <MoreHorizontalIcon className="size-[18px]" />
              </Button>
            }
          />
          <PopoverContent align="end" side="bottom" sideOffset={4} className="w-44 gap-0 p-1.5">
            <button
              type="button"
              className="hover:bg-accent focus-visible:bg-accent flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm outline-none"
              onClick={() => {
                setMenuOpen(false);
                void manager
                  .setWorkspacePinned(directory.id, false)
                  .catch((error) => console.error("[workbench] failed to unpin workspace", error));
              }}
            >
              <PinOffIcon className="size-4" />
              {t("workbench.sidebar.unpinWorkspace")}
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-[2px] ps-6">
          <WorkbenchThreadList
            workspaceId={directory.id}
            showEmpty={false}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
    </section>
  );
}

export function WorkbenchWorkspaceThreadList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const aui = useAui();
  const manager = usePiSessionManager();
  const pathname = usePathname();
  const router = useRouter();
  const isLoading = useAuiState((state) => state.threads.isLoading);
  const hasEmptyDraftNewThread = useAuiState(
    (state) =>
      state.threads.newThreadId !== undefined &&
      state.threads.mainThreadId === state.threads.newThreadId &&
      state.thread.messages.length === 0,
  );
  const directories = useWorkspaceDirectoryStore((state) => state.directories);
  const pinnedDirectoryIds = useWorkspaceDirectoryStore((state) => state.pinnedDirectoryIds);
  const activeDirectoryId = useWorkspaceDirectoryStore((state) => state.activeDirectoryId);
  const draftDirectoryId = useWorkspaceDirectoryStore((state) => state.draftDirectoryId);
  const hasUngroupedThreads = useAuiState((state) =>
    state.threads.threadIds.some((threadId) => {
      const thread = state.threads.threadItems.find((item) => item.id === threadId);
      if (!thread) return false;
      if (thread.custom?.piPinned === true) return false;
      return (
        resolveSidebarThreadWorkspaceId({
          customWorkspaceId: thread.custom?.piWorkspaceId,
          managedWorkspaceId: manager.getThreadCustom(thread.id)?.piWorkspaceId,
          isMainThread: thread.id === state.threads.mainThreadId,
          draftWorkspaceId: draftDirectoryId,
        }) === undefined
      );
    }),
  );
  const syncDirectories = useWorkspaceDirectoryStore((state) => state.syncDirectories);
  const removeDirectory = useWorkspaceDirectoryStore((state) => state.removeDirectory);
  const activateDirectory = useWorkspaceDirectoryStore((state) => state.activateDirectory);
  const destroyNewThread = useWorkspaceDirectoryStore((state) => state.destroyNewThread);
  const threadWorkspaces = usePiWorkspaces();
  const [visibleWorkspaceCount, setVisibleWorkspaceCount] = useState(WORKSPACE_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleDirectories = useMemo(
    () => directories.filter((directory) => !pinnedDirectoryIds.includes(directory.id)),
    [directories, pinnedDirectoryIds],
  );

  const removeWorkspace = async (directoryId: string, active: boolean) => {
    try {
      await manager.deleteWorkspace(directoryId);
      removeDirectory(directoryId);
      if (!active) return;
      aui.threads.switchToNewThread();
      router.push("/");
      onNavigate?.();
    } catch (error) {
      console.error("[workbench] failed to remove workspace", error);
    }
  };

  useEffect(() => {
    syncDirectories(threadWorkspaces);
  }, [syncDirectories, threadWorkspaces]);

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
            <WorkbenchThreadList showEmpty={false} onNavigate={onNavigate} />
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
  onNavigate,
}: {
  directory: WorkspaceDirectory;
  active: boolean;
  hasNewThread: boolean;
  onActivate(): void;
  onRemove(): void;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const workspaceLabelId = useId();
  const workspaceActionId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const manager = usePiSessionManager();
  const pinned = useWorkspaceDirectoryStore((state) =>
    state.pinnedDirectoryIds.includes(directory.id),
  );
  const collapsed = useWorkspaceDirectoryStore((state) =>
    state.collapsedDirectoryIds.includes(directory.id),
  );
  const toggleDirectory = useWorkspaceDirectoryStore((state) => state.toggleDirectory);
  const expanded = !collapsed;
  const expansionLabel = t(
    expanded ? "workbench.sidebar.collapseWorkspace" : "workbench.sidebar.expandWorkspace",
  );
  const toggleExpanded = () => toggleDirectory(directory.id);

  return (
    <section className="flex flex-col gap-0.5">
      <div
        data-workbench-selection-surface=""
        className="group/workspace hover:bg-sidebar-accent focus-within:bg-sidebar-accent relative flex h-9 w-full items-center rounded-lg px-1.5 transition-colors"
      >
        <button
          type="button"
          aria-labelledby={`${workspaceLabelId} ${workspaceActionId}`}
          aria-expanded={expanded}
          className="focus-visible:ring-sidebar-ring absolute inset-0 rounded-lg outline-none focus-visible:ring-2"
          onClick={() => {
            onActivate();
            toggleExpanded();
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
              "absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 opacity-100 transition-[transform,opacity] md:opacity-0 md:group-hover/workspace:opacity-100 md:group-has-[:focus-visible]/workspace:opacity-100",
              expanded && "rotate-90",
            )}
          />
        </div>

        <div
          id={workspaceLabelId}
          className={cn(
            "pointer-events-none min-w-0 flex-1 truncate py-0 ps-1 pe-14 text-start text-sm font-medium transition-[padding] md:pe-1 md:group-hover/workspace:pe-14 md:group-focus-within/workspace:pe-14",
            menuOpen && "md:pe-14",
          )}
        >
          {directory.name}
        </div>
        <span id={workspaceActionId} className="sr-only">
          {expansionLabel}
        </span>

        <div
          className={cn(
            "absolute end-0 z-10 flex items-center opacity-100 transition-opacity md:opacity-0 md:group-hover/workspace:opacity-100 md:group-focus-within/workspace:opacity-100",
            menuOpen && "md:opacity-100",
          )}
        >
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("workbench.sidebar.workspaceOptions")}
                  className="aui-button-icon text-muted-foreground hover:text-foreground focus-visible:text-foreground aria-expanded:text-foreground size-7 p-1 active:scale-90"
                >
                  <MoreHorizontalIcon className="size-[18px]" />
                </Button>
              }
            />
            <PopoverContent align="end" side="bottom" sideOffset={4} className="w-44 gap-0 p-1.5">
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
                  void manager
                    .setWorkspacePinned(directory.id, !pinned)
                    .catch((error) =>
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

      {expanded ? (
        <div className="flex flex-col gap-[2px] ps-6">
          {hasNewThread ? (
            <DraftThreadListItem workspaceId={directory.id} onNavigate={onNavigate} />
          ) : null}
          <WorkbenchThreadList
            workspaceId={directory.id}
            showEmpty={!hasNewThread}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
    </section>
  );
}

function WorkbenchThreadListLoading() {
  return <div className="bg-muted mx-2 h-9 animate-pulse rounded-lg" />;
}
