import { FolderTreeIcon } from "lucide-react";

import type { WorkspaceSurfaceDefinition } from "@/platform/extensions";
import { createLazyWorkspaceSurface, defineExtension } from "@/platform/extensions";

import { ExplorerRuntimeBridge } from "./explorer-runtime-bridge";
import type { ExplorerSurfaceParams } from "./explorer-surface";

const ExplorerSurface = createLazyWorkspaceSurface(async () => {
  const module = await import("./explorer-surface");
  return { default: module.ExplorerSurface };
});

export const explorerSurfaceDefinition = {
  kind: "explorer",
  icon: FolderTreeIcon,
  cachePolicy: "keep-alive",
  persistence: "session",
  defaultPlacement: "auxiliary",
  allowDuplicateResources: false,
  getResourceKey: (params, context) => {
    const contextKey = encodeURIComponent(context.threadId ?? "application");
    if (params.source === "skill") {
      return `explorer:${contextKey}:skill:${encodeURIComponent(params.sessionId)}:${encodeURIComponent(params.skillName)}`;
    }
    const workspaceKey = encodeURIComponent(
      context.worktreeId ?? context.projectId ?? "application",
    );
    return `explorer:${contextKey}:workspace:${workspaceKey}:${encodeURIComponent(params.rootPath)}`;
  },
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  render: ExplorerSurface,
  runtime: ExplorerRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<ExplorerSurfaceParams>;

export const workspaceExplorerExtension = defineExtension({
  id: "workbench.workspace-explorer",
  name: "Workspace Explorer",
  version: "1.0.0",
  setup(context) {
    return context.workspace.register(explorerSurfaceDefinition);
  },
});
