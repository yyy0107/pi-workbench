import type { WorkspaceSurfaceInstance } from "@/platform/extensions";

export {
  WORKSPACE_SCOPE_TYPES,
  WORKSPACE_SURFACE_PLACEMENTS,
  type AnyWorkspaceSurfaceDefinition,
  type OpenSurfaceRequest,
  type SurfaceOpenPolicy,
  type WorkspaceContext,
  type WorkspaceScope,
  type WorkspaceScopeType,
  type WorkspaceSurfaceCachePolicy,
  type WorkspaceSurfaceDefinition,
  type WorkspaceSurfaceInstance,
  type WorkspaceSurfaceKind,
  type WorkspaceSurfaceMenuItemProps,
  type WorkspaceSurfacePlacement,
  type WorkspaceSurfacePersistence,
  type WorkspaceSurfaceProps,
  type WorkspaceSurfaceRegistry,
  type WorkspaceSurfaceStatus,
} from "@/platform/extensions";

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
