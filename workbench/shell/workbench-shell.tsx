"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import { SidebarProvider } from "@/components/ui/sidebar";
import {
  RightWorkspace,
  RightWorkspaceToggleButton,
  resolveRightWorkspacePresentation,
  shouldCollapseRightWorkspaceBeforeSidebar,
  useRightWorkspace,
  useRightWorkspaceState,
} from "@/components/right-workspace";
import { cn } from "@/lib/utils";
import { useMainViewService } from "@/platform/extensions";
import { SlotHost } from "@/platform/extensions/hosts/slot-host";
import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/runtime/pi/client/settings/workbench-settings-client";

import { PanelLayout } from "@/workbench/panels/panel-layout";
import {
  resolveExpandedThreadWidth,
  resolveThreadResponsiveLayout,
  THREAD_CONTENT_COMPACT_GUTTER_PX,
  THREAD_CONTENT_GUTTER_TRANSITION_CLASS_NAME,
  THREAD_CONTENT_INDEX_GUTTER_PX,
} from "@/workbench/chat/thread-content-width";

import { WorkbenchGlobalLayer } from "./workbench-global-layer";
import { WorkbenchHeader } from "./workbench-header";
import { WorkbenchMain } from "./workbench-main";
import { WorkbenchSidebar } from "./workbench-sidebar";
import { WorkbenchStatusbar } from "./workbench-statusbar";

const DEFAULT_SIDEBAR_WIDTH = 268;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 560;
const LEGACY_SIDEBAR_COOKIE_NAME = "sidebar_state";
const THREAD_RESIZE_IDLE_MS = 120;

function readLegacySidebarOpen(): boolean | undefined {
  const prefix = `${LEGACY_SIDEBAR_COOKIE_NAME}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function clearLegacySidebarOpen(): void {
  document.cookie = `${LEGACY_SIDEBAR_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

export function WorkbenchShell({ children }: Readonly<{ children: ReactNode }>) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [maximumSidebarWidth, setMaximumSidebarWidth] = useState(MAX_SIDEBAR_WIDTH);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarAutoCollapsed, setSidebarAutoCollapsed] = useState(false);
  const [sidebarAutoCollapseSuppressed, setSidebarAutoCollapseSuppressed] = useState(false);
  const [conversationIndexHidden, setConversationIndexHidden] = useState(false);
  const sidebarRevision = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const legacyOpen = readLegacySidebarOpen();
    const hydrationRevision = sidebarRevision.current;
    if (legacyOpen !== undefined) setSidebarOpen(legacyOpen);
    void loadWorkbenchSettingsPreferences()
      .then(async (preferences) => {
        if (preferences.sidebarOpen !== undefined) {
          if (sidebarRevision.current === hydrationRevision) {
            setSidebarOpen(preferences.sidebarOpen);
          }
        } else if (sidebarRevision.current === hydrationRevision) {
          await updateWorkbenchSettingsPreferences({ sidebarOpen: legacyOpen ?? true });
        }
        clearLegacySidebarOpen();
      })
      .catch(() => undefined);
  }, []);

  const sidebarEffectivelyOpen =
    sidebarOpen && (!sidebarAutoCollapsed || sidebarAutoCollapseSuppressed);

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      sidebarRevision.current += 1;
      setSidebarOpen(open);
      setSidebarAutoCollapseSuppressed(open && sidebarAutoCollapsed);
      void updateWorkbenchSettingsPreferences({ sidebarOpen: open }).catch(() => undefined);
    },
    [sidebarAutoCollapsed],
  );

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const update = () => {
      const nextMaximum = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, Math.floor(shell.clientWidth / 2)),
      );
      setMaximumSidebarWidth((current) => (current === nextMaximum ? current : nextMaximum));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
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
    let previousThreadWidth: number | undefined;
    let resizeIdleTimer: number | undefined;

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
        previousThreadWidth = undefined;
        setConversationIndexHidden(false);
        setSidebarAutoCollapsed(false);
        setSidebarAutoCollapseSuppressed(false);
        return;
      }

      const currentThreadWidth = observedThreadRoot.getBoundingClientRect().width;
      if (shell.dataset.resizing === "true") {
        previousThreadWidth = currentThreadWidth;
        return;
      }

      if (
        previousThreadWidth !== undefined &&
        Math.abs(currentThreadWidth - previousThreadWidth) > 0.25
      ) {
        shell.dataset.threadResizing = "true";
        if (resizeIdleTimer !== undefined) window.clearTimeout(resizeIdleTimer);
        resizeIdleTimer = window.setTimeout(() => {
          shell.removeAttribute("data-thread-resizing");
          resizeIdleTimer = undefined;
        }, THREAD_RESIZE_IDLE_MS);
      }
      previousThreadWidth = currentThreadWidth;

      const shellWidth = shell.getBoundingClientRect().width;
      const desktopSidebarParticipates = shellWidth >= 768;
      const sidebarOccupiedWidth = desktopSidebarParticipates
        ? (shell
            .querySelector<HTMLElement>('[data-slot="workbench-sidebar-layout"]')
            ?.getBoundingClientRect().width ?? (sidebarEffectivelyOpen ? sidebarWidth : 0))
        : sidebarWidth;
      const expandedThreadWidth = resolveExpandedThreadWidth({
        currentThreadWidth,
        sidebarWidth,
        sidebarOccupiedWidth,
      });
      const layout =
        expandedThreadWidth === undefined
          ? undefined
          : resolveThreadResponsiveLayout(expandedThreadWidth);
      if (!layout) return;

      const nextConversationIndexHidden = layout.conversationIndexHidden;
      const nextConversationGutter = nextConversationIndexHidden
        ? THREAD_CONTENT_COMPACT_GUTTER_PX
        : THREAD_CONTENT_INDEX_GUTTER_PX;

      // ResizeObserver runs after layout but before paint. Synchronize the responsive target on
      // the shell immediately so content widths do not wait for a React commit while the window
      // is resizing; state keeps the declarative model aligned with the DOM afterward.
      shell.dataset.conversationIndex = nextConversationIndexHidden ? "hidden" : "visible";
      shell.style.setProperty("--thread-content-inline-gutter", `${nextConversationGutter}px`);
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
      if (resizeIdleTimer !== undefined) window.clearTimeout(resizeIdleTimer);
      shell.removeAttribute("data-thread-resizing");
    };
  }, [sidebarEffectivelyOpen, sidebarOpen, sidebarWidth, workspacePresentation]);

  const resizeSidebar = useCallback((width: number) => {
    const viewportMaximum = Math.floor((shellRef.current?.clientWidth ?? window.innerWidth) / 2);
    setSidebarWidth(
      Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH, viewportMaximum)),
    );
  }, []);

  return (
    <SidebarProvider
      open={sidebarEffectivelyOpen}
      onOpenChange={handleSidebarOpenChange}
      ref={shellRef}
      className={cn(
        "bg-background text-foreground relative isolate h-dvh min-h-0 overflow-hidden",
        THREAD_CONTENT_GUTTER_TRANSITION_CLASS_NAME,
      )}
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
          "--thread-content-inline-gutter": `${
            conversationIndexHidden
              ? THREAD_CONTENT_COMPACT_GUTTER_PX
              : THREAD_CONTENT_INDEX_GUTTER_PX
          }px`,
          "--desktop-window-controls-inset-end":
            "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))",
          "--right-workspace-toggle-inset-end":
            "calc(0.75rem + var(--desktop-window-controls-inset-end))",
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

      <WorkbenchSidebar
        width={sidebarWidth}
        minWidth={MIN_SIDEBAR_WIDTH}
        maxWidth={maximumSidebarWidth}
        shellRef={shellRef}
        onResize={resizeSidebar}
      />

      <div ref={workspaceHostRef} className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
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
              <WorkbenchMain>{children}</WorkbenchMain>
            </PanelLayout>
            <WorkbenchStatusbar />
          </div>
          {rightWorkspaceVisible ? <RightWorkspace /> : null}
        </div>
        {rightWorkspaceVisible ? (
          <RightWorkspaceToggleButton className="absolute top-[calc((2.5rem-var(--control-hit-default))/2)] z-30 [inset-inline-end:var(--right-workspace-toggle-inset-end)]" />
        ) : null}
      </div>

      <WorkbenchGlobalLayer />
    </SidebarProvider>
  );
}
