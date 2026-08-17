"use client";

import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { PanelDefinition, PanelLocation } from "../api/panel";
import { useExtensionEnvironment } from "../extension-context";
import { ExtensionErrorBoundary } from "./extension-error-boundary";

const NO_PANEL = undefined;

export interface ActivePanel {
  definition: PanelDefinition;
  size: number | undefined;
}

export function useActivePanel(location: PanelLocation): ActivePanel | undefined {
  const { manager, panels } = useExtensionEnvironment();
  const state = useSyncExternalStore(
    panels.subscribe,
    panels.getSnapshot,
    panels.getInitialSnapshot,
  );
  const activePanelId = state.activeByLocation[location];
  const getDefinition = useCallback(
    () => (activePanelId ? manager.panels.get(activePanelId) : NO_PANEL),
    [activePanelId, manager],
  );
  const definition = useSyncExternalStore(manager.panels.subscribe, getDefinition, () => NO_PANEL);
  const configuredSize = state.sizeByLocation[location];

  return useMemo(() => {
    if (!definition) return undefined;
    return {
      definition,
      size: configuredSize ?? definition.defaultSize,
    };
  }, [configuredSize, definition]);
}

export interface PanelHostProps {
  location: PanelLocation;
  className?: string;
  emptyFallback?: ReactNode;
}

export function PanelHost({ location, className, emptyFallback = null }: PanelHostProps) {
  const activePanel = useActivePanel(location);
  const { panels, reportError } = useExtensionEnvironment();

  if (!activePanel) return emptyFallback;

  const { definition } = activePanel;
  const Panel = definition.component;

  return (
    <div className={className} data-panel-host={definition.id} data-panel-location={location}>
      <ExtensionErrorBoundary
        key={definition.id}
        contributionId={definition.id}
        source="panel"
        onError={reportError}
      >
        <Panel panelId={definition.id} close={() => panels.close(definition.id)} />
      </ExtensionErrorBoundary>
    </div>
  );
}
