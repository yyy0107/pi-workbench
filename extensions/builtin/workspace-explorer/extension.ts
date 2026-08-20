import { FolderTreeIcon } from "lucide-react";

import type { WorkspaceSurfaceDefinition } from "@/platform/extensions";
import { defineExtension } from "@/platform/extensions";

import { ExplorerMenuItem } from "./explorer-menu-item";
import { ExplorerSurface, type ExplorerSurfaceParams } from "./explorer-surface";

export const explorerSurfaceDefinition = {
  kind: "explorer",
  icon: FolderTreeIcon,
  cachePolicy: "keep-alive",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    `explorer:${encodeURIComponent(context.worktreeId ?? "application")}:${encodeURIComponent(params.rootPath)}`,
  getDefaultScope: (_params, context) => ({
    type: context.worktreeId ? "worktree" : "application",
    key: context.worktreeId ?? context.applicationId,
  }),
  render: ExplorerSurface,
  menuItem: ExplorerMenuItem,
} satisfies WorkspaceSurfaceDefinition<ExplorerSurfaceParams>;

export const workspaceExplorerExtension = defineExtension({
  id: "workbench.workspace-explorer",
  name: "Workspace Explorer",
  version: "1.0.0",
  setup(context) {
    return context.workspace.register(explorerSurfaceDefinition);
  },
});
