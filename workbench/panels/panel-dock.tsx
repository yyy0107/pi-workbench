"use client";

import {
  PanelHost,
  useActivePanel,
  usePanelService,
  type PanelLocation,
} from "@/platform/extensions";
import { cn } from "@/lib/utils";

import { PanelContainer } from "./panel-container";
import { PanelHeader } from "./panel-header";
import { PanelResizeHandle } from "./panel-resize-handle";

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

  if (!activePanel) return null;

  const { definition } = activePanel;
  const size = activePanel.size ?? definition.defaultSize ?? DEFAULT_PANEL_SIZE[location];

  return (
    <PanelContainer
      location={location}
      size={size}
      className={cn(location === "bottom" ? "w-full" : "h-full", className)}
    >
      <PanelHeader
        title={definition.title}
        icon={definition.icon}
        onClose={() => panels.close(definition.id)}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <PanelHost location={location} className="size-full" />
      </div>
      <PanelResizeHandle
        location={location}
        size={size}
        minSize={definition.minSize}
        maxSize={definition.maxSize}
        onResize={(nextSize) => panels.setSize(location, nextSize)}
      />
    </PanelContainer>
  );
}
