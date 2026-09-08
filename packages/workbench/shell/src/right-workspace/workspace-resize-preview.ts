import { resolveCollapsibleResizePreview } from "../resize/use-collapsible-resize";

import { MIN_RIGHT_WORKSPACE_WIDTH } from "./workspace-store";

export function beginRightWorkspaceResize(element: HTMLElement | null): () => void {
  const layout = element?.closest<HTMLElement>('[data-slot="right-workspace-layout"]');
  const workspace = layout?.querySelector<HTMLElement>(
    '[data-workbench-surface="right-workspace"]',
  );
  const shell = layout?.closest<HTMLElement>("[data-workbench-shell]");
  for (const target of [layout, workspace, shell]) target?.setAttribute("data-resizing", "true");

  return () => {
    for (const target of [layout, workspace, shell]) target?.removeAttribute("data-resizing");
  };
}

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
