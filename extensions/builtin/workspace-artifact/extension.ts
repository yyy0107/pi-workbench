import { FileOutputIcon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@/platform/extensions/authoring";

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
  persistence: "session",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    `artifact:${encodeURIComponent(context.threadId ?? "application")}:${encodeURIComponent(params.artifactId)}`,
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  render: ArtifactSurface,
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
