import { FolderTreeIcon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";
import { fileWorkspaceSessionKey, resolveFileWorkspaceSession } from "../../../workspace-files";

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
    const session = resolveFileWorkspaceSession(params);
    return session
      ? `explorer:${contextKey}:${encodeURIComponent(fileWorkspaceSessionKey(session))}`
      : `explorer:${contextKey}:invalid`;
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
