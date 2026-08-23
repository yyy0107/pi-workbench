import { FileOutputIcon } from "lucide-react";

import type { WorkspaceSurfaceDefinition } from "@/platform/extensions";
import { createLazyWorkspaceSurface, defineExtension } from "@/platform/extensions";

import { ArtifactMenuItem } from "./artifact-menu-item";
import { ArtifactRuntimeBridge } from "./artifact-runtime-bridge";
import type { ArtifactSurfaceParams } from "./artifact-surface";

const ArtifactSurface = createLazyWorkspaceSurface(async () => {
  const module = await import("./artifact-surface");
  return { default: module.ArtifactSurface };
});

export const artifactSurfaceDefinition = {
  kind: "artifact",
  icon: FileOutputIcon,
  cachePolicy: "keep-alive",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    `artifact:${encodeURIComponent(context.threadId ?? "application")}:${encodeURIComponent(params.artifactId)}`,
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  render: ArtifactSurface,
  menuItem: ArtifactMenuItem,
  runtime: ArtifactRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<ArtifactSurfaceParams>;

export const workspaceArtifactExtension = defineExtension({
  id: "workbench.workspace-artifact",
  name: "Workspace Artifact",
  version: "1.0.0",
  setup(context) {
    return context.workspace.register(artifactSurfaceDefinition);
  },
});
