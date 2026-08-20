"use client";

import { useCallback } from "react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";

import {
  resultText,
  stringArg,
  useCompletedWorkspaceToolCalls,
} from "../workspace-shared/runtime-tool-events";
import { artifactPreviewService } from "./artifact-preview-service";

export function ArtifactRuntimeBridge() {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  useCompletedWorkspaceToolCalls(
    useCallback(
      (part) => {
        const artifactId = stringArg(part.args, "artifactId", "artifact_id");
        if (
          !/artifact/i.test(part.toolName) ||
          part.result === undefined ||
          !artifactId ||
          !context.threadId
        ) {
          return false;
        }
        const title = stringArg(part.args, "title", "name") ?? artifactId;
        artifactPreviewService.upsertArtifact({
          id: artifactId,
          threadId: context.threadId,
          title,
          rendererKind: "unknown",
          content: resultText(part.result),
          updatedAt: Date.now(),
        });
        controller.reveal({
          kind: "artifact",
          title,
          params: { artifactId },
          context,
          scope: { type: "thread", key: context.threadId },
          status: "ready",
          policy: "background",
        });
        return true;
      },
      [context, controller],
    ),
  );

  return null;
}
