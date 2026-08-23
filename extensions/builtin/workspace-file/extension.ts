import { FileCode2Icon } from "lucide-react";

import type { WorkspaceSurfaceDefinition } from "@/platform/extensions";
import { createLazyWorkspaceSurface, defineExtension } from "@/platform/extensions";

import { FileMenuItem } from "./file-menu-item";
import { FileRuntimeBridge } from "./file-runtime-bridge";
import { fileOpenHandler } from "./file-opener";
import type { FileSurfaceParams } from "./file-surface";
import { FileSurfaceHeader } from "./file-surface-header";

const FileSurface = createLazyWorkspaceSurface(async () => {
  const module = await import("./file-surface");
  return { default: module.FileSurface };
});

export const fileSurfaceDefinition = {
  kind: "file",
  icon: FileCode2Icon,
  cachePolicy: "keep-alive",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    params.absolutePath
      ? `file:${encodeURIComponent(context.threadId ?? "application")}:${encodeURIComponent(params.absolutePath)}`
      : `file-launcher:${encodeURIComponent(
          context.threadId ?? context.worktreeId ?? context.projectId ?? context.applicationId,
        )}`,
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  header: FileSurfaceHeader,
  render: FileSurface,
  menuItem: FileMenuItem,
  runtime: FileRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<FileSurfaceParams>;

export const workspaceFileExtension = defineExtension({
  id: "workbench.workspace-file",
  name: "Workspace File",
  version: "1.0.0",
  setup(context) {
    const surface = context.workspace.register(fileSurfaceDefinition);
    const opener = context.openers.register(fileOpenHandler);
    return [surface, opener];
  },
});
