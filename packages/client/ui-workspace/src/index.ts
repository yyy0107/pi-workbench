export {
  MIN_HORIZONTAL_SPLIT_WIDTH,
  MIN_PRIMARY_SURFACE_WIDTH,
  WIDE_AUXILIARY_SURFACE_WIDTH,
  auxiliarySurfaceSnapPoints,
  clampAuxiliarySurfaceWidth,
  resolveWorkspaceSplitLayout,
} from "../lib/workspace-split-layout";
export type { WorkspaceSplitLayout } from "../lib/workspace-split-layout";
export { shouldMountWorkspaceSurface } from "../lib/surface-mount-policy";
export { workspaceTabId, workspaceTabPanelId } from "../lib/workspace-tab-a11y";
export { workspaceTabScrollDelta } from "../lib/workspace-tab-layout";
export {
  MIN_CONVERSATION_WIDTH,
  MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH,
  resolveRightWorkspaceMaximumWidth,
  resolveRightWorkspacePresentation,
  shouldCollapseRightWorkspaceBeforeSidebar,
} from "./right-workspace-layout";
export type { RightWorkspacePresentation } from "./right-workspace-layout";
export { applyRightWorkspaceResizePreview } from "./workspace-resize-preview";
