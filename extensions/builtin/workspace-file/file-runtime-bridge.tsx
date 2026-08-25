"use client";

import { useCallback } from "react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { toolResultText, toolStringArg, useCompletedToolCalls } from "@/runtime/tool-events";
import {
  fileWorkspaceContext,
  fileWorkspaceService,
  isPathWithinWorkspace,
} from "@/services/workspace-file-service";

export function FileRuntimeBridge() {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  useCompletedToolCalls(
    useCallback(
      (part) => {
        const path = toolStringArg(part.args, "path", "file_path", "filePath");
        const content = toolResultText(part.result);
        if (
          part.toolName !== "read" ||
          !path ||
          content === undefined ||
          !context.threadId ||
          !context.worktreeId ||
          !context.rootPath
        ) {
          return false;
        }
        // Tool events can render before the workspace context catches up during a thread switch.
        // Leave mismatched paths unconsumed so the next context update can retry them safely.
        if (!isPathWithinWorkspace(context.rootPath, path)) return false;
        const scope = { type: "thread" as const, key: context.threadId };
        const fileSession = {
          source: "workspace" as const,
          rootPath: context.rootPath,
          workspaceId: context.worktreeId,
        };
        const snapshot = fileWorkspaceService.attachFile(
          fileWorkspaceContext(scope, fileSession),
          path,
          content,
        );
        controller.reveal({
          kind: "file",
          title: snapshot.name,
          params: {
            ...fileSession,
            absolutePath: snapshot.path,
            ...(snapshot.relativePath ? { relativePath: snapshot.relativePath } : {}),
            name: snapshot.name,
            mediaType: "text/plain",
            encoding: "utf-8",
            version: snapshot.version,
            size: snapshot.size,
            modifiedAt: snapshot.modifiedAt,
            viewMode: "source",
            diffId: undefined,
            diffCycle: undefined,
          },
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
