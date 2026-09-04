"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import { PanelLeftCloseIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sidebar, useSidebar } from "../ui/sidebar";
import { useI18n } from "../i18n";
import { useMainViewService, useSidebarSectionRegistry } from "@workbench/extension-host";
import { MainViewSidebarHost } from "@workbench/extension-host/hosts/main-view-sidebar-host";
import { SidebarSectionHost } from "@workbench/extension-host/hosts/sidebar-section-host";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import type { SidebarSectionDefinition } from "@workbench/extension-sdk";
import { SidebarPrimaryNavigation } from "../sidebar/sidebar-primary-navigation";
import { applySidebarResizePreview, SidebarResizeHandle } from "../sidebar/sidebar-resize-handle";

const EMPTY_SIDEBAR_SECTIONS = Object.freeze([]) as readonly SidebarSectionDefinition[];

export function WorkbenchSidebarContent({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const { t, text } = useI18n();
  const mainViews = useMainViewService();
  const sectionRegistry = useSidebarSectionRegistry();
  const sections = useSyncExternalStore(
    sectionRegistry.subscribe,
    () => sectionRegistry.getAll(),
    () => EMPTY_SIDEBAR_SECTIONS,
  );
  const [requestedSectionId, setRequestedSectionId] = useState("workspace");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const activeSection = sections.find(({ id }) => id === requestedSectionId) ?? sections[0];

  useEffect(() => {
    const syncActiveSection = () => {
      const active = mainViews.getSnapshot();
      if (!active) return;
      const owningSection = sections.find(({ mainViewKinds }) =>
        mainViewKinds?.includes(active.kind),
      );
      if (owningSection) setRequestedSectionId(owningSection.id);
    };
    syncActiveSection();
    return mainViews.subscribe(syncActiveSection);
  }, [mainViews, sections]);

  const changeSection = (sectionId: string) => {
    const nextSection = sectionRegistry.get(sectionId);
    const activeMainView = mainViews.getSnapshot();
    if (
      activeMainView &&
      (!nextSection?.mainViewKinds || !nextSection.mainViewKinds.includes(activeMainView.kind))
    ) {
      mainViews.close();
    }
    setRequestedSectionId(sectionId);
    setSearchOpen(false);
    setSearchQuery("");
  };

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setSearchQuery("");
      return !open;
    });
  };

  const searchDefinition = activeSection?.search;
  const searchLabel = searchDefinition ? text(searchDefinition.label) : "";
  const searchPlaceholder = searchDefinition ? text(searchDefinition.placeholder) : "";

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
        activeSectionId={activeSection?.id}
        sections={sections}
        searchOpen={searchOpen}
        onSectionChange={changeSection}
        onSearchToggle={toggleSearch}
      />

      <SlotHost
        name="sidebar.navigation"
        className="mx-3 mb-1 flex shrink-0 flex-col gap-1 empty:hidden"
      />

      {searchOpen && searchDefinition ? (
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

      {activeSection ? (
        <SidebarSectionHost
          sectionId={activeSection.id}
          mobile={mobile}
          onNavigate={onNavigate}
          searchQuery={searchQuery}
        />
      ) : null}

      {!mobile && activeSection?.id === "workspace" ? (
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
        className="relative hidden h-full min-h-0 min-w-0 shrink-0 transition-[width] duration-(--layout-motion-duration) ease-(--layout-motion-ease) motion-reduce:transition-none data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width] data-[state=collapsed]:pointer-events-none md:block"
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
          className="bg-sidebar text-sidebar-foreground absolute inset-y-0 left-0 flex min-h-0 min-w-0 flex-col overflow-hidden border-r transition-[width,transform,border-color] duration-(--layout-motion-duration) ease-(--layout-motion-ease) motion-reduce:transition-none in-data-[resizing=true]:transition-none in-data-[resizing=true]:will-change-[width,transform] data-[state=collapsed]:border-transparent"
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
