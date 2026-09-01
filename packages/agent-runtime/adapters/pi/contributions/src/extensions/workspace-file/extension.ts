import { FileCode2Icon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";
import {
  fileWorkspaceSessionKey,
  resolveFileWorkspaceSession,
} from "../../services/workspace-file-service";

import { FileMenuItem } from "./file-menu-item";
import type { FileSurfaceParams } from "./file-surface";
import { FileSurfaceHeader } from "./file-surface-header";

const FileSurface = createLazyWorkspaceSurface(async () => {
  const module = await import("./file-surface");
  return { default: module.FileSurface };
});

export const fileSurfaceDefinition = {
  kind: "file",
  icon: FileCode2Icon,
  cachePolicy: "preserve-dirty",
  allowDuplicateResources: false,
  getResourceKey: (params, context) => {
    const contextKey = encodeURIComponent(context.threadId ?? "application");
    const session = resolveFileWorkspaceSession(params);
    if (!session) return `file-workspace:${contextKey}:invalid`;
    const sessionKey = encodeURIComponent(fileWorkspaceSessionKey(session));
    if (params.absolutePath) {
      return `file:${contextKey}:${sessionKey}:${encodeURIComponent(params.absolutePath)}`;
    }
    return `file-workspace:${contextKey}:${sessionKey}`;
  },
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  header: FileSurfaceHeader,
  render: FileSurface,
  menuItem: FileMenuItem,
} satisfies WorkspaceSurfaceDefinition<FileSurfaceParams>;

export const workspaceFileExtension = defineExtension({
  id: "workbench.workspace-file",
  name: "Workspace File",
  version: "1.0.0",
  setup(context) {
    const surface = context.workspace.register(fileSurfaceDefinition);
    return [surface];
  },
});
