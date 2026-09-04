"use client";

import type { SidebarSectionComponentProps } from "@workbench/extension-sdk";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";

import { useI18n } from "../i18n";
import { SidebarActions, SidebarGroup, SidebarSectionHeading } from "../ui/sidebar-items";
import { WorkbenchPinnedThreadList, WorkbenchWorkspaceThreadList } from "./workspace-thread-list";
import {
  WorkspaceSidebarProvider,
  useWorkspaceSidebar,
  useWorkspaceSidebarItem,
} from "./workspace-sidebar-context";

export function WorkspaceSidebarSection(props: SidebarSectionComponentProps) {
  return (
    <WorkspaceSidebarProvider searchQuery={props.searchQuery}>
      <WorkspaceSidebarContent {...props} />
    </WorkspaceSidebarProvider>
  );
}

function WorkspaceSidebarContent({
  mobile,
  onNavigate,
  searchQuery,
}: SidebarSectionComponentProps) {
  const { t } = useI18n();
  const sidebar = useWorkspaceSidebar();
  const pinned = useWorkspaceSidebarItem("group:pinned");
  const projects = useWorkspaceSidebarItem("group:projects");
  const query = searchQuery.trim().toLocaleLowerCase();
  const hasResults =
    !query ||
    [...sidebar.threadsById.values()].some((thread) =>
      thread.title?.toLocaleLowerCase().includes(query),
    );
  const showPinned =
    sidebar.groups.pinnedThreadIds.length > 0 ||
    sidebar.pinnedDirectories.length > 0 ||
    Boolean(sidebar.dragState.draggingId);

  return (
    <div
      role="region"
      aria-label={t("workbench.shell.workspace")}
      data-workspace-scroll-container
      className="min-h-0 flex-1 overflow-y-auto py-1 ps-3 pe-[2px] [scrollbar-gutter:stable]"
    >
      <div
        className="mb-2 min-w-0"
        onClick={(event) => {
          if (mobile && event.target instanceof Element && event.target.closest("button, a"))
            onNavigate?.();
        }}
      >
        <SlotHost name="sidebar.top" className="empty:hidden" />
      </div>
      {sidebar.error ? (
        <p role="alert" className="text-destructive px-2 py-2 text-xs">
          {sidebar.error}
        </p>
      ) : null}
      {!hasResults ? (
        <p className="text-muted-foreground px-2 py-6 text-center text-xs">
          {t("workbench.sidebar.noSearchResults")}
        </p>
      ) : (
        <>
          {showPinned ? (
            <SidebarGroup
              open={sidebar.expandedGroups.pinned}
              onOpenChange={(open) => {
                if (!pinned.drag.shouldSuppressClick()) sidebar.setGroupExpanded("pinned", open);
              }}
              className="mb-1"
              header={
                <SidebarSectionHeading
                  label={t("workbench.sidebar.pinned")}
                  expanded={sidebar.expandedGroups.pinned}
                  description={t(
                    sidebar.expandedGroups.pinned
                      ? "workbench.sidebar.collapseSection"
                      : "workbench.sidebar.expandSection",
                  )}
                  drag={pinned.drag}
                />
              }
            >
              <WorkbenchPinnedThreadList onNavigate={onNavigate} />
            </SidebarGroup>
          ) : null}
          <SidebarGroup
            open={sidebar.expandedGroups.projects}
            onOpenChange={(open) => {
              if (!projects.drag.shouldSuppressClick()) sidebar.setGroupExpanded("projects", open);
            }}
            header={
              <SidebarSectionHeading
                label={t("workbench.sidebar.projects")}
                expanded={sidebar.expandedGroups.projects}
                description={t(
                  sidebar.expandedGroups.projects
                    ? "workbench.sidebar.collapseSection"
                    : "workbench.sidebar.expandSection",
                )}
                drag={projects.drag}
                actions={
                  <SidebarActions>
                    <SlotHost
                      name="sidebar.workspace.actions"
                      className="flex shrink-0 items-center empty:hidden"
                    />
                  </SidebarActions>
                }
              />
            }
          >
            <WorkbenchWorkspaceThreadList onNavigate={onNavigate} />
          </SidebarGroup>
        </>
      )}
    </div>
  );
}
