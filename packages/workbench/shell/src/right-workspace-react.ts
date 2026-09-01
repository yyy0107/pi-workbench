"use client";

export { RightWorkspaceProvider } from "./right-workspace/right-workspace-provider";
export type {
  RightWorkspaceOpenerFactory,
  RightWorkspaceProviderProps,
} from "./right-workspace/right-workspace-provider";
export {
  useActiveWorkspaceSurface,
  useOpenerService,
  useRightWorkspace,
  useRightWorkspaceState,
  useSetWorkspaceContext,
  useWorkspaceContext,
  useWorkspaceFeedbackState,
  useWorkspaceFeedbackStore,
  useWorkspaceOpen,
  useWorkspaceSurfaceDefinitions,
  useWorkspaceSurfaces,
} from "./right-workspace/right-workspace-context";
export { WorkspaceSurfaceRuntimeHost } from "./right-workspace/workspace-surface-runtime-host";
export { useWorkspaceDraftStore } from "./right-workspace/workspace-draft-store";
export type {
  WorkspaceRuntimeErrorDetails,
  WorkspaceRuntimeErrorReporter,
  WorkspaceSurfaceRuntimeHostProps,
} from "./right-workspace/workspace-surface-runtime-host";
