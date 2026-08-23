import { createStore, type StoreApi } from "zustand/vanilla";

import type { RightWorkspaceState } from "./surface-types";

export const DEFAULT_RIGHT_WORKSPACE_WIDTH = 480;
export const MIN_RIGHT_WORKSPACE_WIDTH = 360;
export const MAX_RIGHT_WORKSPACE_VIEWPORT_RATIO = 0.7;
export const DEFAULT_AUXILIARY_SURFACE_WIDTH = 420;
export const MIN_AUXILIARY_SURFACE_WIDTH = 220;

export const DEFAULT_RIGHT_WORKSPACE_STATE: RightWorkspaceState = Object.freeze({
  open: false,
  width: DEFAULT_RIGHT_WORKSPACE_WIDTH,
  maximized: false,
  activeSurfaceId: null,
  activeAuxiliarySurfaceId: null,
  auxiliaryOpen: true,
  auxiliaryWidth: DEFAULT_AUXILIARY_SURFACE_WIDTH,
  surfaceOrder: Object.freeze([]) as readonly string[],
  surfaces: Object.freeze({}),
  navigationHistory: Object.freeze([]) as readonly string[],
  hydrated: false,
});

export type RightWorkspaceStoreApi = StoreApi<RightWorkspaceState>;

export function createRightWorkspaceStore(
  initial: Partial<RightWorkspaceState> = {},
): RightWorkspaceStoreApi {
  return createStore<RightWorkspaceState>()(() => ({
    ...DEFAULT_RIGHT_WORKSPACE_STATE,
    ...initial,
    surfaceOrder: [...(initial.surfaceOrder ?? DEFAULT_RIGHT_WORKSPACE_STATE.surfaceOrder)],
    surfaces: { ...(initial.surfaces ?? DEFAULT_RIGHT_WORKSPACE_STATE.surfaces) },
    navigationHistory: [
      ...(initial.navigationHistory ?? DEFAULT_RIGHT_WORKSPACE_STATE.navigationHistory),
    ],
  }));
}
