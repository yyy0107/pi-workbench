import type { WorkspaceSurfaceInstance } from "@workbench/extension-sdk";

export interface RightWorkspaceState {
  open: boolean;
  width: number;
  maximized: boolean;
  activeSurfaceId: string | null;
  activeAuxiliarySurfaceId: string | null;
  auxiliaryOpen: boolean;
  auxiliaryWidth: number;
  surfaceOrder: readonly string[];
  surfaces: Readonly<Record<string, WorkspaceSurfaceInstance>>;
  navigationHistory: readonly string[];
  hydrated: boolean;
}

export interface PersistedRightWorkspaceState {
  open: boolean;
  width: number;
  activeSurfaceId: string | null;
  activeAuxiliarySurfaceId: string | null;
  auxiliaryOpen: boolean;
  auxiliaryWidth: number;
  surfaceOrder: string[];
  surfaces: WorkspaceSurfaceInstance[];
}
