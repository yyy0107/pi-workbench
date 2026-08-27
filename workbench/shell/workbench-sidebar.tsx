"use client";

import { useEffect, useId, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  ChevronRightIcon,
  PanelLeftCloseIcon,
  SearchIcon,
  ToolboxIcon,
  WorkflowIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { collapsePanel } from "@/components/elements/surfaces";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useMainViewService } from "@/platform/extensions";
import { SlotHost } from "@/platform/extensions/hosts/slot-host";
import { useWorkbenchAgentThreadSnapshots } from "@/runtime/assistant-ui/agent-runtime-context";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";
import {
  SidebarPrimaryNavigation,
  type SidebarSection,
} from "@/workbench/sidebar/sidebar-primary-navigation";
import { SidebarResizeHandle } from "@/workbench/sidebar/sidebar-resize-handle";
import { hydrateThreadOrderStore } from "@/workbench/sidebar/thread-order-store";
import {
  WorkbenchPinnedThreadList,
  WorkbenchWorkspaceThreadList,
} from "@/workbench/sidebar/workspace-thread-list";

export function WorkbenchSidebarContent({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const mainViews = useMainViewService();
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
  const [activeSection, setActiveSection] = useState<SidebarSection>("workspace");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const hasSearchResults =
    !normalizedSearchQuery ||
    threadItems.some((thread) =>
      (threadStates.get(thread.id)?.title ?? thread.title)
        ?.toLocaleLowerCase()
        .includes(normalizedSearchQuery),
    );

  useEffect(() => {
    void hydrateThreadOrderStore().catch((error) =>
      console.error("[workbench] failed to restore sidebar conversation order", error),
    );
  }, []);

  const changeSection = (section: SidebarSection) => {
    if (section === "workspace") mainViews.close();
    setActiveSection(section);
    setSearchOpen(false);
    setSearchQuery("");
  };

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setSearchQuery("");
      return !open;
    });
  };

  const searchLabel = t(
    activeSection === "toolbox"
      ? "workbench.sidebar.searchToolbox"
      : activeSection === "workflows"
        ? "workbench.sidebar.searchWorkflows"
        : "workbench.sidebar.search",
  );
  const searchPlaceholder = t(
    activeSection === "toolbox"
      ? "workbench.sidebar.searchToolboxPlaceholder"
      : activeSection === "workflows"
        ? "workbench.sidebar.searchWorkflowsPlaceholder"
        : "workbench.sidebar.searchPlaceholder",
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!mobile ? (
        <div className="relative flex h-10 shrink-0 items-center ps-5 pe-2">
          <SlotHost
            name="sidebar.brand"
            className="flex min-w-0 flex-1 items-center empty:hidden"
          />
        </div>
      ) : (
        <MobileSidebarHeader />
      )}

      {!mobile ? (
        <SlotHost
          name="sidebar.header"
          className="flex shrink-0 items-center gap-1 px-4 empty:hidden"
        />
      ) : null}

      <SidebarPrimaryNavigation
        activeSection={activeSection}
        searchOpen={searchOpen}
        onSectionChange={changeSection}
        onSearchToggle={toggleSearch}
      />

      <SlotHost
        name="sidebar.navigation"
        className="mx-3 mb-1 flex shrink-0 flex-col gap-1 empty:hidden"
      />

      {searchOpen ? (
        <div className="relative mx-3 mb-2 shrink-0">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={searchQuery}
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            className="border-border/80 bg-background h-9 rounded-xl ps-9 pe-9 shadow-none [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              if (searchQuery) setSearchQuery("");
              else setSearchOpen(false);
            }}
          />
          <button
            type="button"
            aria-label={t(
              searchQuery ? "workbench.sidebar.clearSearch" : "workbench.sidebar.closeSearch",
            )}
            title={t(
              searchQuery ? "workbench.sidebar.clearSearch" : "workbench.sidebar.closeSearch",
            )}
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring absolute end-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
            onClick={() => {
              if (searchQuery) setSearchQuery("");
              else setSearchOpen(false);
            }}
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : null}

      {activeSection === "workspace" ? (
        <div
          id="workbench-sidebar-workspace-panel"
          role="region"
          aria-label={t("workbench.shell.workspace")}
          data-workspace-scroll-container
          className="min-h-0 flex-1 overflow-y-auto py-1 ps-3 pe-[2px] [scrollbar-gutter:stable]"
        >
          <div
            className="mb-2 min-w-0"
            onClick={(event) => {
              if (
                !mobile ||
                !(event.target instanceof Element) ||
                !event.target.closest("button, a")
              ) {
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
      ) : activeSection === "toolbox" ? (
        <SlotHost
          name="sidebar.toolbox"
          context={{ searchQuery }}
          className="min-h-0 flex-1"
          emptyFallback={
            <SidebarSectionEmptyState
              section="toolbox"
              icon={ToolboxIcon}
              label={t("workbench.sidebar.toolboxEmpty")}
            />
          }
        />
      ) : (
        <SidebarSectionEmptyState
          section={activeSection}
          icon={WorkflowIcon}
          label={t("workbench.sidebar.workflowsEmpty")}
        />
      )}

      {!mobile && activeSection !== "toolbox" ? (
        <SlotHost
          name="sidebar.bottom"
          className="flex shrink-0 flex-col gap-2 px-3 empty:hidden"
        />
      ) : null}

      {!mobile ? (
        <SlotHost
          name="sidebar.footer"
          className="flex min-h-12 shrink-0 items-center gap-2 px-4 pt-2 pb-1 empty:hidden"
        />
      ) : null}
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
      <div className="pointer-events-none flex size-7 shrink-0 items-center justify-center">
        <ChevronRightIcon
          className={cn(
            "size-4 opacity-100 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none md:opacity-0 md:group-hover/sidebar-section:opacity-100 md:group-focus-within/sidebar-section:opacity-100",
            expanded && "rotate-90",
          )}
        />
      </div>
      {actions ? (
        <div className="relative z-10 ms-auto flex shrink-0 items-center opacity-100 transition-opacity duration-150 ease-out motion-reduce:transition-none md:pointer-events-none md:opacity-0 md:group-hover/sidebar-section:pointer-events-auto md:group-hover/sidebar-section:opacity-100 md:group-focus-within/sidebar-section:pointer-events-auto md:group-focus-within/sidebar-section:opacity-100">
          {actions}
        </div>
      ) : null}
      <span id={actionId} className="sr-only">
        {actionLabel}
      </span>
    </div>
  );
}

function SidebarSectionEmptyState({
  section,
  icon: Icon,
  label,
}: {
  section: Exclude<SidebarSection, "workspace">;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div
      id={`workbench-sidebar-${section}-panel`}
      role="region"
      aria-label={label}
      className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-sm"
    >
      <div className="bg-sidebar-accent flex size-11 items-center justify-center rounded-2xl">
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <p>{label}</p>
    </div>
  );
}

function MobileSidebarHeader() {
  const { t } = useI18n();
  const { setOpenMobile } = useSidebar();

  return (
    <div className="flex h-14 shrink-0 items-center justify-between ps-4 pe-2">
      <span className="text-sm font-semibold">{t("workbench.sidebar.conversations")}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("workbench.sidebar.closeMobile")}
        title={t("workbench.sidebar.closeMobile")}
        onClick={() => setOpenMobile(false)}
      >
        <PanelLeftCloseIcon className="size-4" />
      </Button>
    </div>
  );
}

export interface WorkbenchSidebarProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  shellRef: RefObject<HTMLElement | null>;
  onResize(width: number): void;
}

export function WorkbenchSidebar({
  width,
  minWidth,
  maxWidth,
  shellRef,
  onResize,
}: WorkbenchSidebarProps) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile, state } = useSidebar();

  useLayoutEffect(() => {
    if (state !== "collapsed") return;

    shellRef.current?.style.setProperty("--sidebar-width", `${width}px`);
    shellRef.current?.style.setProperty("--sidebar-content-width", `${width}px`);
    shellRef.current?.style.setProperty("--sidebar-resize-translate-x", "0px");
  }, [shellRef, state, width]);

  return (
    <Sidebar
      data-workbench-surface="sidebar"
      aria-label={t("workbench.sidebar.region")}
      closeLabel={t("workbench.sidebar.closeMobile")}
      mobileDescription={t("workbench.sidebar.mobileDescription")}
      mobileTitle={t("workbench.sidebar.mobileTitle")}
      collapsible="offcanvas"
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <WorkbenchSidebarContent
          mobile={isMobile}
          onNavigate={isMobile ? () => setOpenMobile(false) : undefined}
        />
      </div>
      {!isMobile ? (
        <SidebarResizeHandle
          width={width}
          minWidth={minWidth}
          maxWidth={maxWidth}
          shellRef={shellRef}
          onResize={onResize}
        />
      ) : null}
    </Sidebar>
  );
}
