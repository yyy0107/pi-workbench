"use client";

import { useCallback } from "react";

import {
  useRightWorkspace,
  useWorkspaceContext,
  useWorkspaceSurfaces,
} from "@/components/right-workspace";
import { toolStringArg, useCompletedToolCalls } from "@workbench/agent-runtime-client";

import { gitReviewService } from "./git-review-service";

export function ReviewRuntimeBridge() {
  const controller = useRightWorkspace();
  const surfaces = useWorkspaceSurfaces("review");
  const context = useWorkspaceContext();

  useCompletedToolCalls(
    useCallback(
      (part) => {
        if (
          !["write", "edit", "apply_patch"].includes(part.toolName) ||
          part.result === undefined ||
          !context.threadId ||
          !context.worktreeId
        ) {
          return false;
        }
        const path = toolStringArg(part.args, "path", "file_path", "filePath");
        if (path) gitReviewService.noteChanged(context.worktreeId, path);
        const target = surfaces.find(
          (surface) =>
            surface.kind === "review" &&
            surface.scope.type === "thread" &&
            surface.scope.key === context.threadId &&
            surface.params.repositoryId === context.worktreeId,
        );
        if (target) controller.update(target.id, { status: "resource-changed" });
        return true;
      },
      [context, controller, surfaces],
    ),
  );

  return null;
}
