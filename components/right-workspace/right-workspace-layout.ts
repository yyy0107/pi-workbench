import { MIN_RIGHT_WORKSPACE_WIDTH } from "./core/workspace-store";

export const MIN_CONVERSATION_WIDTH = 480;
export const MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH =
  MIN_CONVERSATION_WIDTH + MIN_RIGHT_WORKSPACE_WIDTH;

export type RightWorkspacePresentation = "closed" | "panel" | "maximized";

export function resolveRightWorkspacePresentation(
  open: boolean,
  maximized: boolean,
): RightWorkspacePresentation {
  if (!open) return "closed";
  return maximized ? "maximized" : "panel";
}

export function shouldCollapseRightWorkspaceBeforeSidebar(
  presentation: RightWorkspacePresentation,
  previousAvailableWidth: number,
  availableWidth: number,
): boolean {
  if (presentation !== "panel") return false;
  if (!Number.isFinite(previousAvailableWidth) || !Number.isFinite(availableWidth)) return false;

  return (
    previousAvailableWidth >= MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH &&
    availableWidth < MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH
  );
}
