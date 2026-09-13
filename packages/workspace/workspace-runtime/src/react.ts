"use client";

export { RightWorkspaceProvider } from "./right-workspace-provider";
export type {
  RightWorkspaceOpenerFactory,
  RightWorkspaceProviderProps,
} from "./right-workspace-provider";
export {
  useActiveWorkspaceSurface,
  useOpenerService,
  useRightWorkspace,
  useRightWorkspaceInstallationResource,
  useRightWorkspaceStateStore,
  useRightWorkspaceState,
  useSetWorkspaceContext,
  useWorkspaceContext,
  useWorkspaceFeedbackState,
  useWorkspaceFeedbackStore,
  useWorkspaceOpen,
  useWorkspaceSurfaceDefinitions,
  useWorkspaceSurfaces,
} from "./right-workspace-context";
export { WorkspaceSurfaceRuntimeHost } from "./workspace-surface-runtime-host";
export { useWorkspaceDraftStore } from "./workspace-draft-store";
export type {
  WorkspaceRuntimeErrorDetails,
  WorkspaceRuntimeErrorReporter,
  WorkspaceSurfaceRuntimeHostProps,
} from "./workspace-surface-runtime-host";
