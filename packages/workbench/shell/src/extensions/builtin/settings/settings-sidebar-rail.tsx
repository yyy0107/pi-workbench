"use client";

import type { CSSProperties } from "react";
import type { MainViewSidebarProps } from "@workbench/extension-sdk";
import { useSidebar } from "../../../ui/sidebar";
import type { SettingsMainViewParams } from "./settings-main-view";
import { SettingsSidebar } from "./settings-sidebar";

export function SettingsSidebarRail({ view, close }: MainViewSidebarProps<SettingsMainViewParams>) {
  const { isMobile, open, openMobile, collapsePreview } = useSidebar();
  const showIconMenu = isMobile ? !openMobile : !open || collapsePreview;
  return (
    <aside
      data-workbench-surface="sidebar"
      data-settings-icon-menu=""
      data-state={showIconMenu ? "open" : "closed"}
      aria-hidden={!showIconMenu ? true : undefined}
      inert={!showIconMenu ? true : undefined}
      className="shrink-0 overflow-hidden transition-[width,transform,opacity] duration-(--layout-motion-duration) ease-(--layout-motion-ease) [--settings-icon-menu-progress:var(--settings-icon-menu-target)] in-data-[sidebar-resizing=true]:[--settings-icon-menu-progress:var(--sidebar-collapse-progress,0)] in-data-[resizing=true]:transition-none motion-reduce:transition-none"
      style={
        {
          "--settings-icon-menu-target": showIconMenu ? 1 : 0,
          width: "calc(var(--sidebar-width-icon) * var(--settings-icon-menu-progress))",
          opacity: "var(--settings-icon-menu-progress)",
          transform: "translateX(calc((var(--settings-icon-menu-progress) - 1) * 100%))",
        } as CSSProperties
      }
    >
      <div className="h-full w-[var(--sidebar-width-icon)] border-r border-border">
        <SettingsSidebar view={view} close={close} mobile={isMobile} compact />
      </div>
    </aside>
  );
}
