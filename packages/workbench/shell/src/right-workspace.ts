export type {
  PersistedRightWorkspaceState,
  RightWorkspaceState,
} from "./right-workspace/surface-types";
export {
  DEFAULT_AUXILIARY_SURFACE_WIDTH,
  DEFAULT_RIGHT_WORKSPACE_STATE,
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  MAX_RIGHT_WORKSPACE_VIEWPORT_RATIO,
  MIN_AUXILIARY_SURFACE_WIDTH,
  MIN_RIGHT_WORKSPACE_WIDTH,
  createRightWorkspaceStore,
} from "./right-workspace/workspace-store";
export type { RightWorkspaceStoreApi } from "./right-workspace/workspace-store";
export {
  contextScopeKey,
  scopeMatchesContext,
  selectActiveAuxiliarySurface,
  selectActiveSurface,
  selectContextSurfaces,
  selectContextSurfacesByPlacement,
} from "./right-workspace/workspace-selectors";
export { shouldMountWorkspaceSurface } from "./right-workspace/surface-mount-policy";
export {
  MIN_HORIZONTAL_SPLIT_WIDTH,
  MIN_PRIMARY_SURFACE_WIDTH,
  WIDE_AUXILIARY_SURFACE_WIDTH,
  auxiliarySurfaceSnapPoints,
  clampAuxiliarySurfaceWidth,
  resolveWorkspaceSplitLayout,
} from "./right-workspace/workspace-split-layout";
export type { WorkspaceSplitLayout } from "./right-workspace/workspace-split-layout";
export {
  MIN_CONVERSATION_WIDTH,
  MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH,
  resolveRightWorkspacePresentation,
  shouldCollapseRightWorkspaceBeforeSidebar,
} from "./right-workspace/right-workspace-layout";
export type { RightWorkspacePresentation } from "./right-workspace/right-workspace-layout";
export {
  nextWorkspaceTabIndex,
  workspaceTabId,
  workspaceTabPanelId,
} from "./right-workspace/workspace-tab-a11y";
export { workspaceTabScrollDelta } from "./right-workspace/workspace-tab-layout";
export { applyRightWorkspaceResizePreview } from "./right-workspace/workspace-resize-preview";
export {
  DefaultRightWorkspaceController,
  RightWorkspaceControllerDisposedError,
} from "./right-workspace/workspace-controller";
export type {
  LocalizableTextValidator,
  RightWorkspaceController,
  RightWorkspaceControllerOptions,
  RightWorkspacePersistencePort,
} from "./right-workspace/workspace-controller";
export {
  MemoryWorkspaceFeedbackStore,
  WorkspaceFeedbackStoreDisposedError,
} from "./right-workspace/workspace-feedback-store";
export type {
  WorkspaceFeedbackSnapshot,
  WorkspaceFeedbackStore,
} from "./right-workspace/workspace-feedback-store";
export type {
  WorkspaceFeedback,
  WorkspaceFeedbackClaim,
  WorkspaceFeedbackClaimItem,
  WorkspaceFeedbackClaimPort,
  WorkspaceFeedbackDraft,
  WorkspaceFeedbackKind,
} from "./right-workspace/workspace-feedback-types";
export type {
  RightWorkspaceDraftPersistencePort,
  WorkspaceDraftStore,
} from "./right-workspace/workspace-draft-store";
export { createRightWorkspacePromptFeedbackPort } from "./right-workspace/right-workspace-prompt-feedback";
