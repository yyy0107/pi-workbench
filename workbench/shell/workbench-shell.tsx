"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

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
import { SlotHost } from "@/platform/extensions";

import { PanelLayout } from "@/workbench/panels/panel-layout";

import { WorkbenchGlobalLayer } from "./workbench-global-layer";
import { WorkbenchHeader } from "./workbench-header";
import { WorkbenchMain } from "./workbench-main";
import { WorkbenchSidebar } from "./workbench-sidebar";
import { WorkbenchStatusbar } from "./workbench-statusbar";

const DEFAULT_SIDEBAR_WIDTH = 268;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 560;

export function WorkbenchShell({ children }: Readonly<{ children: ReactNode }>) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
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
          "--right-workspace-toggle-closed-inset-end":
            "calc(0.75rem + var(--desktop-window-controls-inset-end))",
          "--right-workspace-toggle-open-inset-end":
            "calc(0.75rem + min(var(--desktop-window-controls-inset-end), max(0px, calc(2.25rem - env(titlebar-area-height, 0px)))))",
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

      <div ref={workspaceHostRef} className="relative flex min-w-0 flex-1 overflow-hidden">
        <div
          aria-hidden={conversationHidden ? true : undefined}
          inert={conversationHidden ? true : undefined}
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden",
            conversationHidden && "invisible",
          )}
        >
          <WorkbenchHeader />
          <PanelLayout>
            <WorkbenchMain>{children}</WorkbenchMain>
          </PanelLayout>
          <WorkbenchStatusbar />
        </div>
        <RightWorkspace />
        <RightWorkspaceToggleButton
          className={cn(
            "absolute z-30",
            workspaceOpen
              ? "[inset-block-start:calc(env(titlebar-area-height,0px)_+_0.25rem)] [inset-inline-end:var(--right-workspace-toggle-open-inset-end)]"
              : "top-1 [inset-inline-end:var(--right-workspace-toggle-closed-inset-end)]",
          )}
        />
      </div>

      <WorkbenchGlobalLayer />
    </SidebarProvider>
  );
}
