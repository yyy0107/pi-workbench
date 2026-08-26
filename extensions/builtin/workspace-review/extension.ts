import { FileDiffIcon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@/platform/extensions/authoring";

import { ReviewRuntimeBridge } from "./review-runtime-bridge";
import type { ReviewSurfaceParams } from "./review-surface";

const ReviewSurface = createLazyWorkspaceSurface(async () => {
  const module = await import("./review-surface");
  return { default: module.ReviewSurface };
});

export const reviewSurfaceDefinition = {
  kind: "review",
  icon: FileDiffIcon,
  cachePolicy: "unmount",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    [
      "review",
      encodeURIComponent(context.threadId ?? "application"),
      encodeURIComponent(params.repositoryId),
      encodeURIComponent(params.reviewScope),
      encodeURIComponent(params.revision ?? "current"),
    ].join(":"),
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  render: ReviewSurface,
  runtime: ReviewRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<ReviewSurfaceParams>;

export const workspaceReviewExtension = defineExtension({
  id: "workbench.workspace-review",
  name: "Workspace Review",
  version: "1.0.0",
  setup(context) {
    return context.workspace.register(reviewSurfaceDefinition);
  },
});
