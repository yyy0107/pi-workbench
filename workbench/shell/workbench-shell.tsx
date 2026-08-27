"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
import { SlotHost } from "@/platform/extensions/hosts/slot-host";
import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/runtime/pi/client/settings/workbench-settings-client";

import { PanelLayout } from "@/workbench/panels/panel-layout";

import { WorkbenchGlobalLayer } from "./workbench-global-layer";
import { WorkbenchHeader } from "./workbench-header";
import { WorkbenchMain } from "./workbench-main";
import { WorkbenchSidebar } from "./workbench-sidebar";
import { WorkbenchStatusbar } from "./workbench-statusbar";

const DEFAULT_SIDEBAR_WIDTH = 268;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 560;
const LEGACY_SIDEBAR_COOKIE_NAME = "sidebar_state";

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarRevision = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceHostRef = useRef<HTMLDivElement>(null);
  const previousWorkspaceHostWidthRef = useRef<number | undefined>(undefined);
  const workspaceController = useRightWorkspace();
  const workspaceOpen = useRightWorkspaceState((state) => state.open);
  const workspaceMaximized = useRightWorkspaceState((state) => state.maximized);
  const workspacePresentation = resolveRightWorkspacePresentation(
    workspaceOpen,
    workspaceMaximized,
  );
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

  const handleSidebarOpenChange = useCallback((open: boolean) => {
    sidebarRevision.current += 1;
    setSidebarOpen(open);
    void updateWorkbenchSettingsPreferences({ sidebarOpen: open }).catch(() => undefined);
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

  const resizeSidebar = (width: number) => {
    const viewportMaximum = Math.floor(window.innerWidth / 2);
    setSidebarWidth(
      Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH, viewportMaximum),
    );
  };

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={handleSidebarOpenChange}
      ref={shellRef}
      className="bg-background text-foreground relative isolate h-dvh min-h-0 overflow-hidden"
      data-workbench-shell=""
      data-workbench-surface="shell"
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--sidebar-content-width": `${sidebarWidth}px`,
          "--sidebar-resize-translate-x": "0px",
          "--desktop-window-controls-inset-end":
            "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))",
          "--right-workspace-toggle-inset-end":
            "calc(0.75rem + var(--desktop-window-controls-inset-end))",
          "--right-workspace-toggle-reserved-width": "2.375rem",
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
        maxWidth={MAX_SIDEBAR_WIDTH}
        shellRef={shellRef}
        onResize={resizeSidebar}
      />

      <div ref={workspaceHostRef} className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <WorkbenchHeader />
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
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
          <RightWorkspace />
        </div>
        <RightWorkspaceToggleButton className="absolute top-0 z-30 [inset-inline-end:var(--right-workspace-toggle-inset-end)]" />
      </div>

      <WorkbenchGlobalLayer />
    </SidebarProvider>
  );
}
