"use client";

import { useCallback } from "react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import {
  toolResultText,
  toolStringArg,
  useCompletedToolCalls,
} from "@/runtime/assistant-ui/tool-events";
import { artifactPreviewService } from "./artifact-preview-service";

export function ArtifactRuntimeBridge() {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  useCompletedToolCalls(
    useCallback(
      (part) => {
        const artifactId = toolStringArg(part.args, "artifactId", "artifact_id");
        if (
          !/artifact/i.test(part.toolName) ||
          part.result === undefined ||
          !artifactId ||
          !context.threadId
        ) {
          return false;
        }
        const title = toolStringArg(part.args, "title", "name") ?? artifactId;
        const scope = { type: "thread", key: context.threadId } as const;
        artifactPreviewService.upsertArtifact({
          id: artifactId,
          scope,
          title,
          rendererKind: "unknown",
          content: toolResultText(part.result),
          updatedAt: Date.now(),
        });
        controller.reveal({
          kind: "artifact",
          title,
          params: { artifactId },
          context,
          scope,
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
