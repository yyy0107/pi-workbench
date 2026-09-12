"use client";

import { useCallback, useEffect, useRef } from "react";
import { useWorkspaceContext } from "../../../right-workspace-react";
import { useCompletedToolCalls, useSessionState } from "@workbench/agent-runtime-client";
import { useGitReviewService } from "./git-review-service";

export function ReviewRuntimeBridge() {
  const gitReview = useGitReviewService();
  const context = useWorkspaceContext();
  const repositoryId = context.worktreeId ?? context.projectId;
  const running = useSessionState((snapshot) => snapshot.isRunning);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && repositoryId) gitReview.noteChanged(repositoryId);
    wasRunning.current = running;
  }, [running, repositoryId, gitReview]);
  useCompletedToolCalls(
    useCallback(
      (part) => {
        if (
          !["write", "edit", "apply_patch", "bash"].includes(part.toolName) ||
          part.result === undefined ||
          !repositoryId
        )
          return false;
        // Re-read Git even when a tool has no single path argument (for example apply_patch).
        gitReview.noteChanged(repositoryId);
        return true;
      },
      [repositoryId, gitReview],
    ),
  );
  return null;
}
