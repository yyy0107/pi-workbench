import { resolveCollapsibleResizePreview } from "@/hooks/use-collapsible-resize";

import { MIN_RIGHT_WORKSPACE_WIDTH } from "./core/workspace-store";

export function applyRightWorkspaceResizePreview(
  workspaceLayout: HTMLElement | null,
  width: number,
): void {
  const preview = resolveCollapsibleResizePreview(width, MIN_RIGHT_WORKSPACE_WIDTH, -1);
  workspaceLayout?.style.setProperty("--right-workspace-layout-width", `${preview.layoutWidth}px`);
  workspaceLayout?.style.setProperty(
    "--right-workspace-content-width",
    `${preview.contentWidth}px`,
  );
  workspaceLayout?.style.setProperty(
    "--right-workspace-resize-translate-x",
    `${preview.translateX}px`,
  );
}
