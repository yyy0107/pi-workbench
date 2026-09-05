"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentType,
  type ReactNode,
} from "react";

import { LucideProvider } from "lucide-react";

import { SidebarProvider } from "../ui/sidebar";
import { WorkbenchPortalContainerProvider } from "../ui/workbench-portal-container";
import { RightWorkspace, RightWorkspaceToggleButton } from "../right-workspace/presentation";
import { cn } from "../utils";
import { useMainViewService } from "@workbench/extension-host";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import { useWorkbenchSettingsService } from "../settings";
import {
  WorkbenchPresentationProvider,
  type WorkbenchAssets,
  type WorkbenchBranding,
} from "../presentation";
import { RunningIndicatorProvider, type RunningIndicatorCatalog } from "../running-indicator";
import {
  ThreadScrollStateProvider,
  type ThreadScrollPersistencePort,
} from "../thread-scroll-state";
import {
  WorkbenchMain,
  resolveExpandedThreadWidth,
  resolveThreadResponsiveLayout,
} from "../layout";
import { WorkbenchStatusbar } from "../hosts/statusbar";
import {
  resolveRightWorkspacePresentation,
  shouldCollapseRightWorkspaceBeforeSidebar,
} from "../right-workspace";
import { useRightWorkspace, useRightWorkspaceState } from "../right-workspace-react";

import { PanelLayout } from "../panels/panel-layout";
import {
  WorkbenchGlobalLayer,
  type WorkbenchInstallationEffectsProps,
} from "./workbench-global-layer";
import { WorkbenchHeader } from "./workbench-header";
import { WorkbenchSidebar } from "./workbench-sidebar";
import { useSidebarSettingsHydration } from "./use-sidebar-settings-hydration";
import { SidebarDragSessionProvider } from "../hooks/use-sidebar-pointer-reorder";
import { WorkbenchDomIdsProvider } from "../dom";
import { observeWindowResize } from "./window-resize";
import { MOBILE_BREAKPOINT } from "../hooks/use-mobile";

export type { WorkbenchInstallationEffectsProps } from "./workbench-global-layer";

const DEFAULT_SIDEBAR_WIDTH = 268;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 560;

export interface WorkbenchMainViewHostProps {
  children: ReactNode;
}

export interface WorkbenchShellProps {
  assets: WorkbenchAssets;
  branding: WorkbenchBranding;
  children: ReactNode;
  installationEffects?: ComponentType<WorkbenchInstallationEffectsProps>;
  mainViewHost: ComponentType<WorkbenchMainViewHostProps>;
  runningIndicatorCatalog: RunningIndicatorCatalog;
  threadScrollPersistence?: ThreadScrollPersistencePort;
}

export function WorkbenchShell({
  assets,
  branding,
  children,
  installationEffects,
  mainViewHost: MainViewHost,
  runningIndicatorCatalog,
  threadScrollPersistence,
}: Readonly<WorkbenchShellProps>) {
  const settings = useWorkbenchSettingsService();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarAutoCollapsed, setSidebarAutoCollapsed] = useState(false);
  const [sidebarAutoCollapseSuppressed, setSidebarAutoCollapseSuppressed] = useState(false);
  const [conversationIndexHidden, setConversationIndexHidden] = useState(false);
  const sidebarRevision = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const portalContainerRef = useRef<HTMLDivElement>(null);
  const workspaceHostRef = useRef<HTMLDivElement>(null);
  const conversationHostRef = useRef<HTMLDivElement>(null);
  const previousWorkspaceHostWidthRef = useRef<number | undefined>(undefined);
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const rightWorkspaceVisible = activeMainView?.chrome?.rightWorkspace !== "hidden";
  const workspaceController = useRightWorkspace();
  const workspaceOpen = useRightWorkspaceState((state) => state.open);
  const workspaceMaximized = useRightWorkspaceState((state) => state.maximized);
  const workspacePresentation = rightWorkspaceVisible
    ? resolveRightWorkspacePresentation(workspaceOpen, workspaceMaximized)
    : "closed";
  const conversationHidden = workspacePresentation === "maximized";
  useSidebarSettingsHydration(settings, sidebarRevision, setSidebarOpen);

  const sidebarEffectivelyOpen =
    sidebarOpen && (!sidebarAutoCollapsed || sidebarAutoCollapseSuppressed);

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      sidebarRevision.current += 1;
      setSidebarOpen(open);
      setSidebarAutoCollapseSuppressed(open && sidebarAutoCollapsed);
      void settings.update({ sidebarOpen: open }).catch(() => undefined);
    },
    [settings, sidebarAutoCollapsed],
  );

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    return observeWindowResize(shell);
  }, []);

  useLayoutEffect(() => {
    const workspaceHost = workspaceHostRef.current;
    if (!workspaceHost) return;

    const update = () => {
      const availableWidth = workspaceHost.clientWidth;
      const previousAvailableWidth = previousWorkspaceHostWidthRef.current;
      previousWorkspaceHostWidthRef.current = availableWidth;
      if (previousAvailableWidth === undefined) return;

      if (
        shouldCollapseRightWorkspaceBeforeSidebar(
          workspacePresentation,
          previousAvailableWidth,
          availableWidth,
        )
      ) {
        workspaceController.setWorkspaceOpen(false);
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(workspaceHost);
    return () => observer.disconnect();
  }, [workspaceController, workspacePresentation]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const conversationHost = conversationHostRef.current;
    if (!shell || !conversationHost) return;

    let observedThreadRoot: HTMLElement | undefined;
    let observer: ResizeObserver;
    let resizeStateObserver: MutationObserver;

    const update = () => {
      const nextThreadRoot =
        conversationHost.querySelector<HTMLElement>('[data-workbench-surface="thread"]') ??
        undefined;
      if (nextThreadRoot !== observedThreadRoot) {
        if (observedThreadRoot) observer.unobserve(observedThreadRoot);
        observedThreadRoot = nextThreadRoot;
        if (observedThreadRoot) observer.observe(observedThreadRoot);
      }

      if (!observedThreadRoot) {
        setConversationIndexHidden(false);
        setSidebarAutoCollapsed(false);
        setSidebarAutoCollapseSuppressed(false);
        return;
      }

      if (shell.dataset.resizing === "true") return;

      const currentThreadWidth = observedThreadRoot.getBoundingClientRect().width;
      const shellWidth = shell.getBoundingClientRect().width;
      const desktopSidebarParticipates = shellWidth >= MOBILE_BREAKPOINT;
      const sidebarOccupiedWidth = desktopSidebarParticipates
        ? (shell
            .querySelector<HTMLElement>('[data-slot="workbench-sidebar-layout"]')
            ?.getBoundingClientRect().width ?? (sidebarEffectivelyOpen ? sidebarWidth : 0))
        : sidebarWidth;
      const workspaceLayout = workspaceHostRef.current?.querySelector<HTMLElement>(
        '[data-slot="right-workspace-layout"]',
      );
      const workspaceOccupiedWidth = workspaceLayout?.getBoundingClientRect().width ?? 0;
      const workspaceAvailableWidth = workspaceLayout?.parentElement?.clientWidth ?? 0;
      // Use the panel's final width so gutters and panel motion start together, instead of
      // changing the gutter target halfway through the panel's CSS transition.
      const workspaceWidth =
        workspacePresentation === "closed"
          ? 0
          : workspacePresentation === "maximized"
            ? workspaceAvailableWidth
            : Math.min(
                workspaceAvailableWidth,
                Number.parseFloat(
                  workspaceLayout?.style.getPropertyValue("--right-workspace-layout-width") ?? "",
                ) || workspaceOccupiedWidth,
              );
      const expandedThreadWidth = resolveExpandedThreadWidth({
        currentThreadWidth,
        sidebarWidth,
        sidebarOccupiedWidth,
        workspaceWidth,
        workspaceOccupiedWidth,
      });
      const layout =
        expandedThreadWidth === undefined
          ? undefined
          : resolveThreadResponsiveLayout(expandedThreadWidth);
      if (!layout) return;

      const nextConversationIndexHidden = layout.conversationIndexHidden;
      // Synchronize index visibility before paint; content widths follow the container in CSS.
      const nextIndexState = nextConversationIndexHidden ? "hidden" : "visible";
      if (shell.dataset.conversationIndex !== nextIndexState) {
        shell.dataset.conversationIndex = nextIndexState;
      }
      setConversationIndexHidden((current) =>
        current === nextConversationIndexHidden ? current : nextConversationIndexHidden,
      );

      const nextSidebarAutoCollapsed =
        desktopSidebarParticipates &&
        workspacePresentation === "closed" &&
        sidebarOpen &&
        layout.sidebarAutoCollapsed;
      setSidebarAutoCollapsed((current) =>
        current === nextSidebarAutoCollapsed ? current : nextSidebarAutoCollapsed,
      );
      if (!nextSidebarAutoCollapsed) setSidebarAutoCollapseSuppressed(false);
    };

    observer = new ResizeObserver(update);
    observer.observe(shell);
    observer.observe(conversationHost);
    resizeStateObserver = new MutationObserver(() => {
      if (shell.dataset.resizing !== "true") update();
    });
    resizeStateObserver.observe(shell, {
      attributes: true,
      attributeFilter: ["data-resizing"],
    });
    update();

    return () => {
      observer.disconnect();
      resizeStateObserver.disconnect();
    };
  }, [sidebarEffectivelyOpen, sidebarOpen, sidebarWidth, workspacePresentation]);

  const resizeSidebar = useCallback((width: number) => {
    const viewportMaximum = Math.floor((shellRef.current?.clientWidth ?? window.innerWidth) / 2);
    setSidebarWidth(
      Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH, viewportMaximum)),
    );
  }, []);

  return (
    <LucideProvider strokeWidth={1.5}>
      <WorkbenchDomIdsProvider>
        <WorkbenchPresentationProvider assets={assets} branding={branding}>
          <WorkbenchPortalContainerProvider containerRef={portalContainerRef}>
            <ThreadScrollStateProvider persistence={threadScrollPersistence}>
              <RunningIndicatorProvider catalog={runningIndicatorCatalog}>
                <SidebarProvider
                  keyboardShortcutOwnerRef={shellRef}
                  open={sidebarEffectivelyOpen}
                  onOpenChange={handleSidebarOpenChange}
                  ref={shellRef}
                  className="bg-background text-foreground relative isolate h-dvh min-h-0 overflow-hidden"
                  data-workbench-shell=""
                  data-workbench-surface="shell"
                  data-conversation-index={conversationIndexHidden ? "hidden" : "visible"}
                  data-sidebar-auto-collapsed={
                    sidebarAutoCollapsed && !sidebarAutoCollapseSuppressed ? "true" : "false"
                  }
                  style={
                    {
                      "--sidebar-width": `${sidebarWidth}px`,
                      "--sidebar-content-width": `${sidebarWidth}px`,
                      "--sidebar-resize-translate-x": "0px",
                      "--right-workspace-toggle-reserved-width": rightWorkspaceVisible
                        ? "calc(var(--control-hit-default) + 0.125rem)"
                        : "0px",
                    } as CSSProperties
                  }
                >
                  <SlotHost
                    name="shell.background"
                    className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
                  />

                  <SidebarDragSessionProvider>
                    <WorkbenchSidebar
                      width={sidebarWidth}
                      minWidth={MIN_SIDEBAR_WIDTH}
                      maxWidth={MAX_SIDEBAR_WIDTH}
                      shellRef={shellRef}
                      onResize={resizeSidebar}
                    />
                  </SidebarDragSessionProvider>

                  <div
                    ref={workspaceHostRef}
                    className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
                  >
                    <WorkbenchHeader />
                    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                      <div
                        ref={conversationHostRef}
                        aria-hidden={conversationHidden ? true : undefined}
                        inert={conversationHidden ? true : undefined}
                        className={cn(
                          "flex min-w-0 flex-1 flex-col overflow-hidden",
                          conversationHidden && "invisible",
                        )}
                      >
                        <PanelLayout>
                          <WorkbenchMain>
                            <MainViewHost>{children}</MainViewHost>
                          </WorkbenchMain>
                        </PanelLayout>
                        <WorkbenchStatusbar />
                      </div>
                      <RightWorkspace isVisible={rightWorkspaceVisible} />
                    </div>
                    {rightWorkspaceVisible ? (
                      <RightWorkspaceToggleButton className="absolute top-[calc((var(--workbench-header-height)-var(--control-hit-default))/2)] z-30 [inset-inline-end:var(--right-workspace-toggle-inset-end)]" />
                    ) : null}
                  </div>

                  <div
                    ref={portalContainerRef}
                    className="contents"
                    data-workbench-portal-container=""
                  />
                  <WorkbenchGlobalLayer
                    installationEffects={installationEffects}
                    ownerRootRef={shellRef}
                  />
                </SidebarProvider>
              </RunningIndicatorProvider>
            </ThreadScrollStateProvider>
          </WorkbenchPortalContainerProvider>
        </WorkbenchPresentationProvider>
      </WorkbenchDomIdsProvider>
    </LucideProvider>
  );
}
