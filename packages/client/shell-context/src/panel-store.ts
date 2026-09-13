"use client";

import { createStore, type StoreApi } from "zustand/vanilla";

import type { PanelLocation } from "@workbench/extension-sdk";

export interface PanelStoreData {
  openedPanelIds: readonly string[];
  activeByLocation: Partial<Record<PanelLocation, string>>;
  collapsedByLocation: Partial<Record<PanelLocation, boolean>>;
  locationByPanelId: Record<string, PanelLocation>;
  sizeByLocation: Partial<Record<PanelLocation, number>>;
}

export interface PanelStoreActions {
  open(panelId: string, location?: PanelLocation): void;
  close(panelId: string): void;
  toggle(panelId: string, location?: PanelLocation): void;
  activate(panelId: string): void;
  move(panelId: string, location: PanelLocation): void;
  collapse(location: PanelLocation): void;
  expand(location: PanelLocation): void;
  setSize(location: PanelLocation, size: number): void;
  reset(): void;
}

export type PanelStoreState = PanelStoreData & PanelStoreActions;
export type PanelStoreApi = StoreApi<PanelStoreState>;

function findFallbackPanel(
  openedPanelIds: readonly string[],
  locationByPanelId: Readonly<Record<string, PanelLocation>>,
  location: PanelLocation,
  excludedPanelId?: string,
): string | undefined {
  for (let index = openedPanelIds.length - 1; index >= 0; index -= 1) {
    const candidate = openedPanelIds[index];
    if (candidate !== excludedPanelId && locationByPanelId[candidate] === location) {
      return candidate;
    }
  }
  return undefined;
}

export function createPanelStore(initialData: Partial<PanelStoreData> = {}): PanelStoreApi {
  const initial: PanelStoreData = {
    openedPanelIds: Object.freeze([...(initialData.openedPanelIds ?? [])]),
    activeByLocation: { ...initialData.activeByLocation },
    collapsedByLocation: { ...initialData.collapsedByLocation },
    locationByPanelId: { ...initialData.locationByPanelId },
    sizeByLocation: { ...initialData.sizeByLocation },
  };

  return createStore<PanelStoreState>()((set, get) => ({
    ...initial,

    open(panelId, requestedLocation) {
      set((state) => {
        const location = requestedLocation ?? state.locationByPanelId[panelId] ?? "bottom";
        const previousLocation = state.locationByPanelId[panelId];
        const isOpen = state.openedPanelIds.includes(panelId);

        if (
          isOpen &&
          previousLocation === location &&
          state.activeByLocation[location] === panelId &&
          !state.collapsedByLocation[location]
        ) {
          return state;
        }

        const openedPanelIds = isOpen
          ? state.openedPanelIds
          : Object.freeze([...state.openedPanelIds, panelId]);
        const locationByPanelId = {
          ...state.locationByPanelId,
          [panelId]: location,
        };
        const activeByLocation = { ...state.activeByLocation };

        if (
          previousLocation &&
          previousLocation !== location &&
          activeByLocation[previousLocation] === panelId
        ) {
          const fallback = findFallbackPanel(
            openedPanelIds,
            locationByPanelId,
            previousLocation,
            panelId,
          );
          if (fallback) activeByLocation[previousLocation] = fallback;
          else delete activeByLocation[previousLocation];
        }

        activeByLocation[location] = panelId;
        return {
          openedPanelIds,
          locationByPanelId,
          activeByLocation,
          collapsedByLocation: {
            ...state.collapsedByLocation,
            [location]: false,
          },
        };
      });
    },

    close(panelId) {
      set((state) => {
        if (!state.openedPanelIds.includes(panelId)) return state;

        const openedPanelIds = Object.freeze(state.openedPanelIds.filter((id) => id !== panelId));
        const location = state.locationByPanelId[panelId];
        const activeByLocation = { ...state.activeByLocation };

        if (location && activeByLocation[location] === panelId) {
          const fallback = findFallbackPanel(openedPanelIds, state.locationByPanelId, location);
          if (fallback) activeByLocation[location] = fallback;
          else delete activeByLocation[location];
        }

        return { openedPanelIds, activeByLocation };
      });
    },

    toggle(panelId, location) {
      const state = get();
      if (state.openedPanelIds.includes(panelId)) state.close(panelId);
      else state.open(panelId, location);
    },

    activate(panelId) {
      set((state) => {
        if (!state.openedPanelIds.includes(panelId)) return state;
        const location = state.locationByPanelId[panelId];
        if (!location) {
          return state;
        }
        if (state.activeByLocation[location] === panelId && !state.collapsedByLocation[location]) {
          return state;
        }
        return {
          activeByLocation: {
            ...state.activeByLocation,
            [location]: panelId,
          },
          collapsedByLocation: {
            ...state.collapsedByLocation,
            [location]: false,
          },
        };
      });
    },

    move(panelId, location) {
      set((state) => {
        const previousLocation = state.locationByPanelId[panelId];
        const isOpen = state.openedPanelIds.includes(panelId);
        if (previousLocation === location) {
          if (!isOpen) {
            return state;
          }
          if (
            state.activeByLocation[location] === panelId &&
            !state.collapsedByLocation[location]
          ) {
            return state;
          }
          return {
            activeByLocation: {
              ...state.activeByLocation,
              [location]: panelId,
            },
            collapsedByLocation: {
              ...state.collapsedByLocation,
              [location]: false,
            },
          };
        }

        const locationByPanelId = {
          ...state.locationByPanelId,
          [panelId]: location,
        };
        if (!isOpen) return { locationByPanelId };

        const activeByLocation = {
          ...state.activeByLocation,
          [location]: panelId,
        };
        if (previousLocation && state.activeByLocation[previousLocation] === panelId) {
          const fallback = findFallbackPanel(
            state.openedPanelIds,
            locationByPanelId,
            previousLocation,
            panelId,
          );
          if (fallback) activeByLocation[previousLocation] = fallback;
          else delete activeByLocation[previousLocation];
        }

        return {
          locationByPanelId,
          activeByLocation,
          collapsedByLocation: {
            ...state.collapsedByLocation,
            [location]: false,
          },
        };
      });
    },

    collapse(location) {
      set((state) => {
        if (!state.activeByLocation[location] || state.collapsedByLocation[location]) {
          return state;
        }
        return {
          collapsedByLocation: {
            ...state.collapsedByLocation,
            [location]: true,
          },
        };
      });
    },

    expand(location) {
      set((state) => {
        if (!state.collapsedByLocation[location]) return state;
        return {
          collapsedByLocation: {
            ...state.collapsedByLocation,
            [location]: false,
          },
        };
      });
    },

    setSize(location, size) {
      if (!Number.isFinite(size)) {
        throw new Error("Panel size must be a finite number");
      }
      set((state) => {
        if (state.sizeByLocation[location] === size) return state;
        return {
          sizeByLocation: { ...state.sizeByLocation, [location]: size },
        };
      });
    },

    reset() {
      set(initial);
    },
  }));
}
