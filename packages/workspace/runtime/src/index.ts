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
export { shouldMountWorkspaceSurface } from "../lib/surface-mount-policy";
export {
  MIN_HORIZONTAL_SPLIT_WIDTH,
  MIN_PRIMARY_SURFACE_WIDTH,
  WIDE_AUXILIARY_SURFACE_WIDTH,
  auxiliarySurfaceSnapPoints,
  clampAuxiliarySurfaceWidth,
  resolveWorkspaceSplitLayout,
} from "../lib/workspace-split-layout";
export type { WorkspaceSplitLayout } from "../lib/workspace-split-layout";
export {
  MIN_CONVERSATION_WIDTH,
  MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH,
  resolveRightWorkspacePresentation,
  shouldCollapseRightWorkspaceBeforeSidebar,
} from "./right-workspace-layout";
export type { RightWorkspacePresentation } from "./right-workspace-layout";
export { workspaceTabId, workspaceTabPanelId } from "../lib/workspace-tab-a11y";
export { workspaceTabScrollDelta } from "../lib/workspace-tab-layout";
export { applyRightWorkspaceResizePreview } from "./workspace-resize-preview";
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
export { createRightWorkspacePromptFeedbackPort } from "./right-workspace-prompt-feedback";
