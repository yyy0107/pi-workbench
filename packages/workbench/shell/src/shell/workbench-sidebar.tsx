"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { withTooltip } from "../ui/tooltip";

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
          className="flex h-(--workbench-header-height) shrink-0 items-center ps-5 pe-2 empty:hidden"
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
          {withTooltip(
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
              <XIcon aria-hidden="true" className="size-[var(--icon-size-md)]" />
            </button>,
            0,
          )}
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
  const desktopState = isMobile ? "collapsed" : state;
  const sidebarLayoutRef = useRef<HTMLDivElement>(null);
  const [maximumWidth, setMaximumWidth] = useState(maxWidth);
  const renderedWidth = Math.min(maximumWidth, width);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const update = () => {
      const nextMaximum = Math.max(minWidth, Math.min(maxWidth, Math.floor(shell.clientWidth / 2)));
      setMaximumWidth((current) => (current === nextMaximum ? current : nextMaximum));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [maxWidth, minWidth, shellRef]);

  useLayoutEffect(() => {
    // Preserve the drag's final zero width when committing a collapse. Restoring the
    // expanded width here would replay the collapse transition after pointer release.
    if (state !== "expanded") return;
    applySidebarResizePreview(sidebarLayoutRef.current, shellRef.current, renderedWidth, minWidth);
  }, [minWidth, renderedWidth, shellRef, state]);

  // Keep the desktop tree mounted across breakpoints so both directions can transition.
  // Window constraints only resize the frame; keep the conversation list out of that render path.
  const content = useMemo(
    () => (
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <MainViewSidebarHost mobile={false}>
          <WorkbenchSidebarContent />
        </MainViewSidebarHost>
      </div>
    ),
    [],
  );

  return (
    <>
      <div
        ref={sidebarLayoutRef}
        data-slot="workbench-sidebar-layout"
        data-state={desktopState}
        className="relative h-full min-h-0 min-w-0 shrink-0 transition-[width,--workbench-sidebar-expansion] ease-(--layout-motion-ease) motion-reduce:transition-none data-[resizing=true]:transition-none data-[resizing=true]:will-change-[width] data-[state=collapsed]:pointer-events-none"
        style={
          {
            "--workbench-sidebar-expansion": desktopState === "expanded" ? 1 : 0,
            width: `min(calc(var(--workbench-sidebar-layout-width, ${renderedWidth}px) * var(--workbench-sidebar-expansion)), 100%)`,
            maxWidth: "100%",
            transitionDuration: "var(--layout-motion-duration), var(--sidebar-motion-duration)",
          } as CSSProperties
        }
      >
        <aside
          data-workbench-surface="sidebar"
          data-slot="sidebar"
          data-state={desktopState}
          aria-label={t("workbench.sidebar.region")}
          aria-hidden={desktopState === "collapsed" ? true : undefined}
          inert={desktopState === "collapsed" ? true : undefined}
          className="bg-sidebar text-sidebar-foreground absolute inset-y-0 left-0 flex min-h-0 min-w-0 flex-col overflow-hidden border-r transition-[width,transform,border-color] ease-(--layout-motion-ease) motion-reduce:transition-none in-data-[resizing=true]:transition-none in-data-[resizing=true]:will-change-[width,transform] data-[state=collapsed]:border-transparent"
          style={
            {
              width: `min(var(--workbench-sidebar-content-width, ${renderedWidth}px), 100vw)`,
              maxWidth: "100vw",
              transitionDuration:
                "var(--layout-motion-duration), var(--sidebar-motion-duration), var(--sidebar-motion-duration)",
              transform:
                desktopState === "expanded"
                  ? "translateX(var(--workbench-sidebar-resize-translate-x, 0px))"
                  : "translateX(-100%)",
            } as CSSProperties
          }
        >
          <div data-sidebar="sidebar" data-slot="sidebar-inner" className="flex size-full flex-col">
            {content}
          </div>
          {desktopState === "expanded" ? (
            <SidebarResizeHandle
              width={renderedWidth}
              minWidth={minWidth}
              maxWidth={maximumWidth}
              sidebarLayoutRef={sidebarLayoutRef}
              shellRef={shellRef}
              onResize={onResize}
            />
          ) : null}
        </aside>
      </div>
      <MainViewSidebarHost rail mobile={isMobile}>
        {null}
      </MainViewSidebarHost>
      {isMobile ? (
        <Sidebar
          data-workbench-surface="sidebar"
          aria-label={t("workbench.sidebar.region")}
          closeLabel={t("workbench.sidebar.closeMobile")}
          mobileDescription={t("workbench.sidebar.mobileDescription")}
          mobileTitle={t("workbench.sidebar.mobileTitle")}
          collapsible="offcanvas"
        >
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <MainViewSidebarHost mobile onNavigate={() => setOpenMobile(false)}>
              <WorkbenchSidebarContent mobile onNavigate={() => setOpenMobile(false)} />
            </MainViewSidebarHost>
          </div>
        </Sidebar>
      ) : null}
    </>
  );
}
