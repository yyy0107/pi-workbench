"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { useExtensionManager, usePanelService, type PanelDefinition } from "@/platform/extensions";

export interface RightPanelController {
  activePanelId: string | undefined;
  canToggle: boolean;
  isOpen: boolean;
  panels: readonly PanelDefinition[];
  close(panelId: string): void;
  collapse(): void;
  select(panelId: string): void;
  toggle(): void;
}

export function useRightPanelController(): RightPanelController {
  const manager = useExtensionManager();
  const panelService = usePanelService();
  const lastActivePanelId = useRef<string | undefined>(undefined);
  const getDefinitions = useCallback(() => manager.panels.getAll(), [manager]);
  const subscribeDefinitions = useCallback(
    (listener: () => void) => manager.panels.subscribe(listener),
    [manager],
  );
  const definitions = useSyncExternalStore(subscribeDefinitions, getDefinitions, getDefinitions);
  const state = useSyncExternalStore(
    panelService.subscribe,
    panelService.getSnapshot,
    panelService.getInitialSnapshot,
  );
  const activePanelId = state.activeByLocation.right;
  const availablePanels = useMemo(
    () =>
      definitions.filter(
        (definition) =>
          definition.defaultLocation === "right" ||
          state.locationByPanelId[definition.id] === "right",
      ),
    [definitions, state.locationByPanelId],
  );
  const openedPanels = useMemo(() => {
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    return state.openedPanelIds.flatMap((panelId) => {
      if (state.locationByPanelId[panelId] !== "right") return [];
      const definition = definitionsById.get(panelId);
      return definition ? [definition] : [];
    });
  }, [definitions, state.locationByPanelId, state.openedPanelIds]);
  const isOpen = activePanelId !== undefined && !state.collapsedByLocation.right;

  useEffect(() => {
    if (activePanelId) lastActivePanelId.current = activePanelId;
  }, [activePanelId]);

  const collapse = useCallback(() => {
    panelService.collapse("right");
  }, [panelService]);

  const close = useCallback((panelId: string) => panelService.close(panelId), [panelService]);

  const select = useCallback(
    (panelId: string) => {
      const current = panelService.getSnapshot();
      if (current.locationByPanelId[panelId] !== "right") {
        panelService.move(panelId, "right");
      }

      if (panelService.isOpen(panelId)) panelService.activate(panelId);
      else panelService.open(panelId);
    },
    [panelService],
  );

  const toggle = useCallback(() => {
    if (isOpen) {
      collapse();
      return;
    }

    if (panelService.getActivePanelId("right")) {
      panelService.expand("right");
      return;
    }

    const preferredPanelId = lastActivePanelId.current;
    const preferredPanel = availablePanels.find((panel) => panel.id === preferredPanelId);
    const nextPanel = preferredPanel ?? availablePanels[0];
    if (nextPanel) select(nextPanel.id);
  }, [availablePanels, collapse, isOpen, panelService, select]);

  return {
    activePanelId,
    canToggle: availablePanels.length > 0,
    isOpen,
    panels: openedPanels,
    close,
    collapse,
    select,
    toggle,
  };
}
