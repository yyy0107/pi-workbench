"use client";

import { useCallback } from "react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";

import {
  stringArg,
  resultText,
  useCompletedWorkspaceToolCalls,
} from "../workspace-shared/runtime-tool-events";
import { fileWorkspaceService } from "./file-workspace-service";

export function FileRuntimeBridge() {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  useCompletedWorkspaceToolCalls(
    useCallback(
      (part) => {
        const path = stringArg(part.args, "path", "file_path", "filePath");
        const content = resultText(part.result);
        if (
          part.toolName !== "read" ||
          !path ||
          content === undefined ||
          !context.threadId ||
          !context.worktreeId
        ) {
          return false;
        }
        fileWorkspaceService.attachFile(path, content);
        controller.reveal({
          kind: "file",
          title: path.split(/[\\/]/).at(-1) ?? path,
          params: { absolutePath: path },
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
