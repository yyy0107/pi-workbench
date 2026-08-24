"use client";

import { useId, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  CheckIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SlotHost, useMainViewService } from "@/platform/extensions";
import { useWorkspaceSelection } from "@/services/workspace-selection-service";
import {
  SidebarPrimaryNavigation,
  type SidebarSection,
} from "@/workbench/sidebar/sidebar-primary-navigation";
import { SidebarResizeHandle } from "@/workbench/sidebar/sidebar-resize-handle";
import type { ThreadAutomaticSortMode } from "@/workbench/sidebar/thread-sort";
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
  const hasPinnedThreads = useAuiState((state) =>
    state.threads.threadIds.some((threadId) => {
      const thread = state.threads.threadItems.find((item) => item.id === threadId);
      return thread?.custom?.piPinned === true;
    }),
  );
  const hasPinnedDirectories = useWorkspaceSelection().workspaces.some(
    (workspace) => workspace.pinned === true,
  );
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [threadSortMode, setThreadSortMode] = useState<ThreadAutomaticSortMode>("priority");
  const [threadSortRevision, setThreadSortRevision] = useState(0);
  const [activeSection, setActiveSection] = useState<SidebarSection>("workspace");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const hasSearchResults = useAuiState((state) => {
    if (!normalizedSearchQuery) return true;

    return state.threads.threadItems.some((thread) =>
      thread.title?.toLocaleLowerCase().includes(normalizedSearchQuery),
    );
  });

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
        <div className="flex h-10 shrink-0 items-center gap-3 ps-5 pe-2">
          <SlotHost
            name="sidebar.brand"
            className="flex min-w-0 flex-1 items-center empty:hidden"
          />
          <SidebarCollapseButton />
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
                    <ProjectSectionActions
                      sortMode={threadSortMode}
                      onSortModeChange={(mode) => {
                        setThreadSortMode(mode);
                        setThreadSortRevision((revision) => revision + 1);
                      }}
                    />
                  }
                />
                <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
                  <WorkbenchWorkspaceThreadList
                    searchQuery={searchQuery}
                    threadSortMode={threadSortMode}
                    threadSortRevision={threadSortRevision}
                    onNavigate={onNavigate}
                  />
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

      {!mobile && activeSection !== "toolbox" ? (
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

function ProjectSectionActions({
  sortMode,
  onSortModeChange,
}: {
  sortMode: ThreadAutomaticSortMode;
  onSortModeChange(mode: ThreadAutomaticSortMode): void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const sortOptions = [
    { value: "priority", label: t("workbench.sidebar.chatSortPriority") },
    { value: "recent", label: t("workbench.sidebar.chatSortRecent") },
  ] as const;

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("workbench.sidebar.chatSortTitle")}
              title={t("workbench.sidebar.chatSortTitle")}
              className="text-muted-foreground hover:text-foreground focus-visible:border-transparent focus-visible:ring-0"
            >
              <MoreHorizontalIcon aria-hidden="true" className="size-4" />
            </Button>
          }
        />
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={4}
          role="menu"
          aria-label={t("workbench.sidebar.chatSortTitle")}
          className="w-44 gap-0 p-1.5 duration-150 ease-out data-[side=bottom]:slide-in-from-top-1 data-open:zoom-in-100 data-closed:zoom-out-100 motion-reduce:animate-none"
        >
          <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs">
            {t("workbench.sidebar.chatSortTitle")}
          </p>
          {sortOptions.map((option) => {
            const selected = sortMode === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="hover:bg-accent focus-visible:bg-accent grid h-8 w-full grid-cols-[1fr_1rem] items-center gap-2 rounded-md px-2 text-start text-sm outline-none"
                onClick={() => {
                  onSortModeChange(option.value);
                  setMenuOpen(false);
                }}
              >
                <span>{option.label}</span>
                <span className="flex size-4 items-center justify-center">
                  {selected ? <CheckIcon aria-hidden="true" className="size-4" /> : null}
                </span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
      <SlotHost
        name="sidebar.workspace.actions"
        className="flex shrink-0 items-center empty:hidden"
      />
    </>
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

function SidebarCollapseButton() {
  const { t } = useI18n();
  const { setOpen } = useSidebar();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("workbench.sidebar.collapse")}
      title={t("workbench.sidebar.collapse")}
      onClick={() => setOpen(false)}
      className="text-muted-foreground hover:text-foreground"
    >
      <PanelLeftCloseIcon className="size-4" />
    </Button>
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
