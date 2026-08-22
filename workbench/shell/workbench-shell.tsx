"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { RightWorkspace, useRightWorkspaceState } from "@/components/right-workspace";
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
  const workspaceOpen = useRightWorkspaceState((state) => state.open);
  const workspaceMaximized = useRightWorkspaceState((state) => state.maximized);
  const conversationHidden = workspaceOpen && workspaceMaximized;

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
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
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

      <div className="flex min-w-0 flex-1 overflow-hidden">
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
      </div>

      <WorkbenchGlobalLayer />
    </SidebarProvider>
  );
}
