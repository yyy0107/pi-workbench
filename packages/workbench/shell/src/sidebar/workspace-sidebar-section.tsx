"use client";

import { useId, useState, type ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ChevronRightIcon } from "lucide-react";

import { useWorkbenchAgentThreadSnapshots } from "@workbench/agent-runtime-client/context";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import type { SidebarSectionComponentProps } from "@workbench/extension-sdk";

import { collapsePanel } from "../ui/surface";
import { useI18n } from "../i18n";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { cn } from "../utils";
import { useHydrateThreadOrderStore } from "./thread-order-store";
import { WorkbenchPinnedThreadList, WorkbenchWorkspaceThreadList } from "./workspace-thread-list";

export function WorkspaceSidebarSection({
  mobile,
  onNavigate,
  searchQuery,
}: SidebarSectionComponentProps) {
  const { t } = useI18n();
  useHydrateThreadOrderStore();
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const threadStates = useWorkbenchAgentThreadSnapshots(threadIds);
  const hasPinnedThreads = threadIds.some(
    (threadId) => threadStates.get(threadId)?.isPinned === true,
  );
  const hasPinnedDirectories = useWorkspaceSelection().workspaces.some(
    (workspace) => workspace.pinned === true,
  );
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const panelId = useId();
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const hasSearchResults =
    !normalizedSearchQuery ||
    threadItems.some((thread) =>
      (threadStates.get(thread.id)?.title ?? thread.title)
        ?.toLocaleLowerCase()
        .includes(normalizedSearchQuery),
    );

  return (
    <div
      id={panelId}
      role="region"
      aria-label={t("workbench.shell.workspace")}
      data-workspace-scroll-container
      className="min-h-0 flex-1 overflow-y-auto py-1 ps-3 pe-[2px] [scrollbar-gutter:stable]"
    >
      <div
        className="mb-2 min-w-0"
        onClick={(event) => {
          if (!mobile || !(event.target instanceof Element) || !event.target.closest("button, a")) {
            return;
          }
          onNavigate?.();
        }}
      >
        <SlotHost name="sidebar.top" className="empty:hidden" />
      </div>

      {normalizedSearchQuery && !hasSearchResults ? (
        <p className="text-muted-foreground px-2 py-6 text-center text-xs leading-relaxed">
          {t("workbench.sidebar.noSearchResults")}
        </p>
      ) : (
        <>
          {hasPinnedThreads || hasPinnedDirectories ? (
            <Collapsible
              render={<section />}
              open={pinnedExpanded}
              onOpenChange={setPinnedExpanded}
              className="mb-1 flex flex-col gap-0.5"
            >
              <SidebarSectionHeading
                label={t("workbench.sidebar.pinned")}
                expanded={pinnedExpanded}
              />
              <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
                <WorkbenchPinnedThreadList searchQuery={searchQuery} onNavigate={onNavigate} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          <Collapsible
            render={<section />}
            open={projectsExpanded}
            onOpenChange={setProjectsExpanded}
            className="flex flex-col gap-0.5"
          >
            <SidebarSectionHeading
              label={t("workbench.sidebar.projects")}
              expanded={projectsExpanded}
              actions={
                <SlotHost
                  name="sidebar.workspace.actions"
                  className="flex shrink-0 items-center empty:hidden"
                />
              }
            />
            <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
              <WorkbenchWorkspaceThreadList searchQuery={searchQuery} onNavigate={onNavigate} />
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}

function SidebarSectionHeading({
  label,
  expanded,
  actions,
}: {
  label: string;
  expanded: boolean;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const labelId = useId();
  const actionId = useId();
  const actionLabel = t(
    expanded ? "workbench.sidebar.collapseSection" : "workbench.sidebar.expandSection",
  );

  return (
    <div className="group/sidebar-section relative flex h-9 w-full shrink-0 items-center rounded-lg ps-2">
      <CollapsibleTrigger
        type="button"
        aria-labelledby={`${labelId} ${actionId}`}
        className="absolute inset-0 rounded-lg outline-none"
      />
      <h2
        id={labelId}
        className="text-muted-foreground pointer-events-none min-w-0 text-sm font-medium"
      >
        {label}
      </h2>
      <div className="pointer-events-none flex size-[var(--icon-frame-size-default)] shrink-0 items-center justify-center">
        <ChevronRightIcon
          className={cn(
            "size-[var(--icon-size-md)] opacity-100 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none md:opacity-0 md:group-hover/sidebar-section:opacity-100 md:group-focus-within/sidebar-section:opacity-100",
            expanded && "rotate-90",
          )}
        />
      </div>
      {actions ? (
        <div
          data-sidebar-actions=""
          className="relative z-10 ms-auto flex shrink-0 opacity-100 transition-opacity duration-150 ease-out motion-reduce:transition-none md:pointer-events-none md:opacity-0 md:group-hover/sidebar-section:pointer-events-auto md:group-hover/sidebar-section:opacity-100 md:group-focus-within/sidebar-section:pointer-events-auto md:group-focus-within/sidebar-section:opacity-100"
        >
          {actions}
        </div>
      ) : null}
      <span id={actionId} className="sr-only">
        {actionLabel}
      </span>
    </div>
  );
}
