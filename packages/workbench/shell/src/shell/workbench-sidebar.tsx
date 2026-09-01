"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  ChevronRightIcon,
  PanelLeftCloseIcon,
  SearchIcon,
  ToolboxIcon,
  ZapIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { collapsePanel } from "../elements/surfaces";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Sidebar, useSidebar } from "../ui/sidebar";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { useMainViewService } from "@workbench/extension-host";
import { MainViewSidebarHost } from "@workbench/extension-host/hosts/main-view-sidebar-host";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import { useWorkbenchAgentThreadSnapshots } from "@workbench/agent-runtime-client/context";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";
import {
  SidebarPrimaryNavigation,
  type SidebarSection,
} from "../sidebar/sidebar-primary-navigation";
import { applySidebarResizePreview, SidebarResizeHandle } from "../sidebar/sidebar-resize-handle";
import { useHydrateThreadOrderStore } from "../sidebar/thread-order-store";
import {
  WorkbenchPinnedThreadList,
  WorkbenchWorkspaceThreadList,
} from "../sidebar/workspace-thread-list";

export function WorkbenchSidebarContent({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  useHydrateThreadOrderStore();
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
  const workspacePanelId = useId();
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const hasSearchResults =
    !normalizedSearchQuery ||
    threadItems.some((thread) =>
      (threadStates.get(thread.id)?.title ?? thread.title)
        ?.toLocaleLowerCase()
        .includes(normalizedSearchQuery),
    );

  useEffect(() => {
    const syncActiveSection = () => {
      const active = mainViews.getSnapshot();
      if (active?.kind === "automations") setActiveSection("automations");
      else if (active?.kind === "toolbox") setActiveSection("toolbox");
    };
    syncActiveSection();
    return mainViews.subscribe(syncActiveSection);
  }, [mainViews]);

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
    activeSection === "toolbox" ? "workbench.sidebar.searchToolbox" : "workbench.sidebar.search",
  );
  const searchPlaceholder = t(
    activeSection === "toolbox"
      ? "workbench.sidebar.searchToolboxPlaceholder"
      : "workbench.sidebar.searchPlaceholder",
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!mobile ? (
        <SlotHost
          name="sidebar.brand"
          className="flex h-10 shrink-0 items-center ps-5 pe-2 empty:hidden"
        />
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
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-[var(--input-control-icon-size)] -translate-y-1/2"
          />
          <Input
            type="search"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={searchQuery}
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            className="ps-9 pe-8 shadow-none [&::-webkit-search-cancel-button]:hidden"
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
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute end-1 top-1/2 flex size-[var(--icon-frame-size-compact)] -translate-y-1/2 items-center justify-center rounded-[var(--button-radius)] outline-none hover:[background:var(--icon-frame-background-hover)] focus-visible:ring-2"
            onClick={() => {
              if (searchQuery) setSearchQuery("");
              else setSearchOpen(false);
            }}
          >
            <XIcon aria-hidden="true" className="size-[var(--icon-size-sm)]" />
          </button>
        </div>
      ) : null}

      {activeSection === "workspace" ? (
        <div
          id={workspacePanelId}
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
        <SlotHost
          name="sidebar.automations"
          context={{ searchQuery }}
          className="min-h-0 flex-1"
          emptyFallback={
            <SidebarSectionEmptyState
              section="automations"
              icon={ZapIcon}
              label={t("workbench.sidebar.automationsEmpty")}
            />
          }
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

function SidebarSectionEmptyState({
  section,
  icon: Icon,
  label,
}: {
  section: Exclude<SidebarSection, "workspace">;
  icon: LucideIcon;
  label: string;
}) {
  const panelId = useId();
  return (
    <div
      id={panelId}
      data-sidebar-section={section}
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
  const sidebarLayoutRef = useRef<HTMLDivElement>(null);
  const renderedWidth = Math.min(maxWidth, width);

  useLayoutEffect(() => {
    applySidebarResizePreview(sidebarLayoutRef.current, shellRef.current, renderedWidth, minWidth);
  }, [minWidth, renderedWidth, shellRef, state]);

  const content = (
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <MainViewSidebarHost
        mobile={isMobile}
        onNavigate={isMobile ? () => setOpenMobile(false) : undefined}
      >
        <WorkbenchSidebarContent
          mobile={isMobile}
          onNavigate={isMobile ? () => setOpenMobile(false) : undefined}
        />
      </MainViewSidebarHost>
    </div>
  );

  if (!isMobile) {
    return (
      <div
        ref={sidebarLayoutRef}
        data-slot="workbench-sidebar-layout"
        data-state={state}
        className="relative hidden h-full min-h-0 min-w-0 shrink-0 transition-[width] duration-[240ms] ease-[cubic-bezier(0.45,0,0.8,0.7)] motion-reduce:transition-none data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width] data-[state=collapsed]:pointer-events-none md:block"
        style={
          {
            width:
              state === "collapsed"
                ? 0
                : `min(var(--workbench-sidebar-layout-width, ${renderedWidth}px), 100%)`,
            maxWidth: "100%",
          } as CSSProperties
        }
      >
        <aside
          data-workbench-surface="sidebar"
          data-slot="sidebar"
          data-state={state}
          aria-label={t("workbench.sidebar.region")}
          aria-hidden={state === "collapsed" ? true : undefined}
          inert={state === "collapsed" ? true : undefined}
          className="bg-sidebar text-sidebar-foreground absolute inset-y-0 left-0 flex min-h-0 min-w-0 flex-col overflow-hidden border-r transition-[width,transform,border-color] duration-[240ms] ease-[cubic-bezier(0.45,0,0.8,0.7)] motion-reduce:transition-none in-data-[resizing=true]:transition-none in-data-[resizing=true]:will-change-[width,transform] data-[state=collapsed]:border-transparent"
          style={
            {
              width: `min(var(--workbench-sidebar-content-width, ${renderedWidth}px), 100vw)`,
              maxWidth: "100vw",
              transform:
                state === "expanded"
                  ? "translateX(var(--workbench-sidebar-resize-translate-x, 0px))"
                  : "translateX(-100%)",
            } as CSSProperties
          }
        >
          <div data-sidebar="sidebar" data-slot="sidebar-inner" className="flex size-full flex-col">
            {content}
          </div>
          {state === "expanded" ? (
            <SidebarResizeHandle
              width={renderedWidth}
              minWidth={minWidth}
              maxWidth={maxWidth}
              sidebarLayoutRef={sidebarLayoutRef}
              shellRef={shellRef}
              onResize={onResize}
            />
          ) : null}
        </aside>
      </div>
    );
  }

  return (
    <Sidebar
      data-workbench-surface="sidebar"
      aria-label={t("workbench.sidebar.region")}
      closeLabel={t("workbench.sidebar.closeMobile")}
      mobileDescription={t("workbench.sidebar.mobileDescription")}
      mobileTitle={t("workbench.sidebar.mobileTitle")}
      collapsible="offcanvas"
    >
      {content}
    </Sidebar>
  );
}
