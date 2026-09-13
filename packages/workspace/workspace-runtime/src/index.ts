export type { PersistedRightWorkspaceState, RightWorkspaceState } from "./surface-types";
export {
  DEFAULT_AUXILIARY_SURFACE_WIDTH,
  DEFAULT_RIGHT_WORKSPACE_STATE,
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  MAX_RIGHT_WORKSPACE_VIEWPORT_RATIO,
  MIN_AUXILIARY_SURFACE_WIDTH,
  MIN_RIGHT_WORKSPACE_WIDTH,
  createRightWorkspaceStore,
} from "./workspace-store";
export type { RightWorkspaceStoreApi } from "./workspace-store";
export {
  contextScopeKey,
  scopeMatchesContext,
  selectActiveAuxiliarySurface,
  selectActiveSurface,
  selectContextSurfaces,
  selectContextSurfacesByPlacement,
} from "./workspace-selectors";
export {
  DefaultRightWorkspaceController,
  RightWorkspaceControllerDisposedError,
} from "./workspace-controller";
export type {
  LocalizableTextValidator,
  RightWorkspaceController,
  RightWorkspaceControllerOptions,
  RightWorkspacePersistencePort,
} from "./workspace-controller";
export {
  MemoryWorkspaceFeedbackStore,
  WorkspaceFeedbackStoreDisposedError,
} from "./workspace-feedback-store";
export type { WorkspaceFeedbackSnapshot, WorkspaceFeedbackStore } from "./workspace-feedback-store";
export type {
  WorkspaceFeedback,
  WorkspaceFeedbackClaim,
  WorkspaceFeedbackClaimItem,
  WorkspaceFeedbackClaimPort,
  WorkspaceFeedbackDraft,
  WorkspaceFeedbackKind,
} from "./workspace-feedback-types";
export type {
  RightWorkspaceDraftPersistencePort,
  WorkspaceDraftStore,
} from "./workspace-draft-store";
export { createWorkspaceDraftStore } from "./workspace-draft-store";
export { createRightWorkspacePromptFeedbackPort } from "./right-workspace-prompt-feedback";
export { createRightWorkspaceInstallation } from "./workspace-installation";
export type {
  RightWorkspaceInstallation,
  RightWorkspaceInstallationInputs,
  RightWorkspaceOpenerFactory,
  RightWorkspaceStateStore,
} from "./workspace-installation";
