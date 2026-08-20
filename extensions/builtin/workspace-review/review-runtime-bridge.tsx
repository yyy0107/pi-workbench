"use client";

import { useCallback, useMemo } from "react";

import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
} from "@/components/right-workspace";

import { stringArg, useCompletedWorkspaceToolCalls } from "../workspace-shared/runtime-tool-events";
import { gitReviewService } from "./git-review-service";

export function ReviewRuntimeBridge() {
  const controller = useRightWorkspace();
  const surfacesById = useRightWorkspaceState((state) => state.surfaces);
  const surfaces = useMemo(() => Object.values(surfacesById), [surfacesById]);
  const context = useWorkspaceContext();

  useCompletedWorkspaceToolCalls(
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
        const path = stringArg(part.args, "path", "file_path", "filePath");
        if (path) gitReviewService.noteChanged(context.worktreeId, path);
        const target = surfaces.find(
          (surface) =>
            surface.kind === "review" && surface.params.repositoryId === context.worktreeId,
        );
        if (target) controller.update(target.id, { status: "resource-changed" });
        return true;
      },
      [context, controller, surfaces],
    ),
  );

  return null;
}
