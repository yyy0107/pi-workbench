"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { SidebarProvider } from "@/components/ui/sidebar";

import { PanelDock } from "@/workbench/panels/panel-dock";
import { PanelLayout } from "@/workbench/panels/panel-layout";

import { WorkbenchGlobalLayer } from "./workbench-global-layer";
import { WorkbenchHeader } from "./workbench-header";
import { WorkbenchMain } from "./workbench-main";
import { WorkbenchSidebar } from "./workbench-sidebar";
import { WorkbenchStatusbar } from "./workbench-statusbar";

const DEFAULT_SIDEBAR_WIDTH = 368;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 560;

export function WorkbenchShell({ children }: Readonly<{ children: ReactNode }>) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);

  const resizeSidebar = (width: number) => {
    const viewportMaximum = Math.floor(window.innerWidth / 2);
    setSidebarWidth(
      Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH, viewportMaximum),
    );
  };

  return (
    <SidebarProvider
      className="bg-background text-foreground h-dvh min-h-0 overflow-hidden"
      data-resizing={isSidebarResizing ? "true" : undefined}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <WorkbenchSidebar
        width={sidebarWidth}
        minWidth={MIN_SIDEBAR_WIDTH}
        maxWidth={MAX_SIDEBAR_WIDTH}
        onResize={resizeSidebar}
        onResizingChange={setIsSidebarResizing}
      />

      <div className="flex min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <WorkbenchHeader />
          <PanelLayout>
            <WorkbenchMain>{children}</WorkbenchMain>
          </PanelLayout>
          <WorkbenchStatusbar />
        </div>
        <PanelDock location="right" />
      </div>

      <WorkbenchGlobalLayer />
    </SidebarProvider>
  );
}
