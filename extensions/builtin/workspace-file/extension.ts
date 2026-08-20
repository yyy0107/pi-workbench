import { FileCode2Icon } from "lucide-react";

import type { WorkspaceSurfaceDefinition } from "@/platform/extensions";
import { defineExtension } from "@/platform/extensions";

import { FileRuntimeBridge } from "./file-runtime-bridge";
import { FileSurface, type FileSurfaceParams } from "./file-surface";

export const fileSurfaceDefinition = {
  kind: "file",
  icon: FileCode2Icon,
  cachePolicy: "keep-alive",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    `file:${encodeURIComponent(context.threadId ?? "application")}:${encodeURIComponent(params.absolutePath)}`,
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  render: FileSurface,
  runtime: FileRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<FileSurfaceParams>;

export const workspaceFileExtension = defineExtension({
  id: "workbench.workspace-file",
  name: "Workspace File",
  version: "1.0.0",
  setup(context) {
    return context.workspace.register(fileSurfaceDefinition);
  },
});
