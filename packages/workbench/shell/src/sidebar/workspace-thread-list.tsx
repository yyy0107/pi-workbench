"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  ChevronRightIcon,
  FolderIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { WorkspaceSummary } from "@workbench/agent-runtime-client/workspaces";

import { Button } from "../ui/button";
import { CollapsibleTrigger } from "../ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SidebarActions, SidebarGroup, SidebarRow, SidebarStatus } from "../ui/sidebar-items";
import { Skeleton } from "../ui/skeleton";
import { useI18n } from "../i18n";
import { useAppearancePreferences } from "../appearance";
import { NewThreadButton } from "./new-thread-button";
import { RunningThreadIndicator } from "./running-thread-indicator";
import { WorkbenchThreadList } from "./thread-list";
import {
  SidebarMoveMenuItems,
  sidebarWorkspaceKey,
  useWorkspaceSidebar,
  useWorkspaceSidebarItem,
} from "./workspace-sidebar-context";

const WORKSPACE_PAGE_SIZE = 24;

export function WorkbenchPinnedThreadList({ onNavigate }: { onNavigate?: () => void }) {
  const sidebar = useWorkspaceSidebar();
  return (
    <div className="flex flex-col gap-(--sidebar-list-gap)">
      <WorkbenchThreadList pinnedOnly showEmpty={false} onNavigate={onNavigate} />
      {sidebar.pinnedDirectories.map((directory) => (
        <WorkspaceDirectorySection
          key={directory.id}
          directory={directory}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

export function WorkbenchWorkspaceThreadList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const sidebar = useWorkspaceSidebar();
  const { isHome } = sidebar.navigation;
  const {
    directories,
    selection,
    capabilities: { destroyNewThread },
  } = sidebar;
  const [visibleCount, setVisibleCount] = useState(WORKSPACE_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isHome) destroyNewThread();
  }, [destroyNewThread, isHome]);
  useEffect(() => {
    const selectedIndex = Math.max(
      ...[selection.activeWorkspaceId, selection.draftWorkspaceId, sidebar.revealedWorkspaceId].map(
        (id) => directories.findIndex((directory) => directory.id === id),
      ),
    );
    if (selectedIndex >= visibleCount)
      setVisibleCount(
        Math.min(
          directories.length,
          Math.ceil((selectedIndex + 1) / WORKSPACE_PAGE_SIZE) * WORKSPACE_PAGE_SIZE,
        ),
      );
  }, [
    directories,
    selection.activeWorkspaceId,
    selection.draftWorkspaceId,
    sidebar.revealedWorkspaceId,
    visibleCount,
  ]);
  const hasMore = visibleCount < directories.length;
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting)
          setVisibleCount((count) => Math.min(count + WORKSPACE_PAGE_SIZE, directories.length));
      },
      {
        root: target.closest("[data-workspace-scroll-container]"),
        rootMargin: "0px 0px 240px 0px",
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [directories.length, hasMore, visibleCount]);

  if (sidebar.isLoading && selection.workspaces.length === 0)
    return (
      <Skeleton className="h-[var(--sidebar-row-height)] rounded-[var(--sidebar-row-radius)]" />
    );
  if (selection.workspaces.length === 0 && sidebar.groups.ungroupedThreadIds.length === 0)
    return (
      <p className="text-muted-foreground px-2 py-3 text-xs">
        {t("workbench.sidebar.noWorkspaces")}
      </p>
    );
  return (
    <div className="flex flex-col gap-(--sidebar-list-gap)">
      {directories.slice(0, visibleCount).map((directory) => (
        <WorkspaceDirectorySection
          key={directory.id}
          directory={directory}
          onNavigate={onNavigate}
        />
      ))}
      {hasMore ? (
        <div
          ref={loadMoreRef}
          role="status"
          aria-label={t("workbench.sidebar.loadingMoreWorkspaces")}
        >
          <Skeleton className="h-[var(--sidebar-row-height)] rounded-[var(--sidebar-row-radius)]" />
        </div>
      ) : null}
      {sidebar.groups.ungroupedThreadIds.length > 0 ? (
        <section>
          <h3 className="text-muted-foreground px-2 py-1 text-xs font-medium">
            {t("workbench.sidebar.ungrouped")}
          </h3>
          <WorkbenchThreadList showEmpty={false} onNavigate={onNavigate} />
        </section>
      ) : null}
    </div>
  );
}

const WorkspaceDirectorySection = memo(function WorkspaceDirectorySection({
  directory,
  onNavigate,
}: {
  directory: WorkspaceSummary;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const { runningIndicatorId } = useAppearancePreferences();
  const sidebar = useWorkspaceSidebar(
    useShallow((state) => ({
      active: state.selection.activeWorkspaceId === directory.id,
      expanded: !state.selection.collapsedWorkspaceIds.includes(directory.id),
      running: state.groups.runningWorkspaceIds.has(directory.id),
      searchQuery: state.searchQuery,
      capabilities: state.capabilities,
      runtime: state.runtime,
      pending: state.dragState.pending,
      openHome: state.navigation.openHome,
    })),
  );
  const controls = useWorkspaceSidebarItem(sidebarWorkspaceKey(directory.id));
  const { drag } = controls;
  const [menuOpen, setMenuOpen] = useState(false);
  const { active, expanded } = sidebar;
  const FolderStateIcon = expanded ? FolderOpenIcon : FolderIcon;
  const running = !expanded && sidebar.running;
  const pinned = directory.pinned === true;
  const query = sidebar.searchQuery.trim().toLocaleLowerCase();
  const remove = async () => {
    try {
      await sidebar.capabilities.removeWorkspace(directory.id);
      if (active) {
        sidebar.runtime.switchToNewThread();
        sidebar.openHome();
        onNavigate?.();
      }
    } catch (error) {
      console.error("[workbench] failed to remove workspace", error);
    }
  };

  return (
    <SidebarGroup
      open={expanded}
      animateContent
      dropPosition={drag.dropPosition === "inside" ? undefined : drag.dropPosition}
      onOpenChange={(open) => {
        if (drag.shouldSuppressClick()) return;
        sidebar.capabilities.activateWorkspace(directory.id);
        if (open !== expanded) sidebar.capabilities.setWorkspaceCollapsed(directory.id, !open);
      }}
      header={
        <SidebarRow
          variant="folder"
          label={directory.name}
          menuOpen={menuOpen}
          drag={{ ...drag, dropPosition: drag.dropPosition === "inside" ? "inside" : undefined }}
          trigger={<CollapsibleTrigger />}
          description={
            <>
              {t(
                expanded
                  ? "workbench.sidebar.collapseWorkspace"
                  : "workbench.sidebar.expandWorkspace",
              )}
              {running ? <span> {t("workbench.sidebar.generating")}</span> : null}
            </>
          }
          icon={<FolderStateIcon className={active ? "text-primary" : undefined} />}
          hoverIcon={<ChevronRightIcon className={expanded ? "rotate-90" : undefined} />}
          status={
            running && runningIndicatorId !== "none" ? (
              <SidebarStatus>
                <RunningThreadIndicator id={runningIndicatorId} />
              </SidebarStatus>
            ) : undefined
          }
          actions={
            <SidebarActions
              desktop={
                <NewThreadButton
                  workspaceId={directory.id}
                  variant="icon"
                  onNavigate={onNavigate}
                />
              }
            >
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={sidebar.pending}
                      aria-label={t("workbench.sidebar.workspaceOptions")}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="sidebar-menu w-max">
                  <NewThreadButton
                    workspaceId={directory.id}
                    variant="menu"
                    onNavigate={onNavigate}
                  />
                  <DropdownMenuItem
                    onClick={() => {
                      void sidebar.capabilities
                        .openWorkspaceFolder(directory.id)
                        .catch((error) =>
                          console.error("[workbench] failed to open workspace folder", error),
                        );
                    }}
                  >
                    <FolderOpenIcon />
                    {t("workbench.sidebar.openWorkspaceFolder")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={controls.togglePinned}>
                    {pinned ? <PinOffIcon /> : <PinIcon />}
                    {t(
                      pinned
                        ? "workbench.sidebar.unpinWorkspace"
                        : "workbench.sidebar.pinWorkspace",
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <SidebarMoveMenuItems controls={controls} />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
                    <FolderMinusIcon />
                    {t("workbench.sidebar.removeWorkspace")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarActions>
          }
        />
      }
    >
      <WorkbenchThreadList workspaceId={directory.id} showEmpty={!query} onNavigate={onNavigate} />
    </SidebarGroup>
  );
});
