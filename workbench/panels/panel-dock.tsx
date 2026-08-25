"use client";

import { useState, useSyncExternalStore } from "react";

import { usePanelService, type PanelLocation } from "@/platform/extensions";
import { PanelHost, useActivePanel } from "@/platform/extensions/hosts/panel-host";
import { cn } from "@/lib/utils";

import { PanelContainer } from "./panel-container";
import { PanelHeader } from "./panel-header";
import { PanelResizeHandle } from "./panel-resize-handle";
import { PanelTabContent } from "./panel-tab-content";
import { RightPanelTabs } from "./right-panel-tabs";

const DEFAULT_PANEL_SIZE: Record<PanelLocation, number> = {
  left: 320,
  right: 360,
  bottom: 280,
};

export interface PanelDockProps {
  location: PanelLocation;
  className?: string;
}

export function PanelDock({ location, className }: PanelDockProps) {
  const activePanel = useActivePanel(location);
  const panels = usePanelService();
  const panelState = useSyncExternalStore(
    panels.subscribe,
    panels.getSnapshot,
    panels.getInitialSnapshot,
  );
  const [isResizing, setIsResizing] = useState(false);
  const [isResizeSessionActive, setIsResizeSessionActive] = useState(false);

  if (!activePanel) return null;

  const { definition } = activePanel;
  const size = activePanel.size ?? definition.defaultSize ?? DEFAULT_PANEL_SIZE[location];
  const isCollapsed = panelState.collapsedByLocation[location] === true;
  const isHidden = isCollapsed && !isResizeSessionActive;

  return (
    <PanelContainer
      location={location}
      size={isCollapsed ? 0 : size}
      aria-hidden={isCollapsed ? true : undefined}
      inert={isHidden ? true : undefined}
      data-collapsed={isCollapsed ? "true" : "false"}
      data-resizing={isResizing ? "true" : "false"}
      className={cn(
        "transition-[width,height] duration-150 ease-linear motion-reduce:transition-none",
        isResizing && "transition-none",
        isCollapsed && "border-transparent",
        isHidden && "pointer-events-none",
        location === "bottom" ? "w-full" : "h-full",
        className,
      )}
    >
      {location === "right" ? (
        <RightPanelTabs />
      ) : (
        <PanelHeader
          title={<PanelTabContent definition={definition} isActive />}
          onClose={() => panels.close(definition.id)}
        />
      )}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <PanelHost location={location} className="size-full" />
      </div>
      <PanelResizeHandle
        location={location}
        size={size}
        minSize={definition.minSize}
        maxSize={definition.maxSize}
        collapsible={location === "right"}
        onResize={(nextSize) => panels.setSize(location, nextSize)}
        onCollapse={location === "right" ? () => panels.collapse(location) : undefined}
        onExpand={location === "right" ? () => panels.expand(location) : undefined}
        onResizingChange={setIsResizing}
        onResizeSessionChange={setIsResizeSessionActive}
      />
    </PanelContainer>
  );
}
