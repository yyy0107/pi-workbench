"use client";

import { useMemo } from "react";
import { ReviewableDiff } from "@workbench/code-highlighting";
import { useWorkspaceContext } from "@workbench/ui-workspace/react";
import { workspaceRelativePath } from "@workbench/workspace-files";
import type { ToolRendererProps } from "@workbench/extension-sdk";

import { fileMutationToolModel } from "../lib/file-mutation-tool-model";

export function FileMutationToolRenderer({ block, fallback }: ToolRendererProps) {
  const { rootPath } = useWorkspaceContext();
  const model = useMemo(
    () =>
      block.status === "complete"
        ? fileMutationToolModel({
            toolName: block.toolName,
            toolCallId: block.callId,
            args: block.arguments,
            result: block.result,
          })
        : undefined,
    [block],
  );
  const displayPath = useMemo(() => {
    if (!model) return undefined;
    try {
      const relativePath = workspaceRelativePath(rootPath, model.path);
      return relativePath.startsWith("../") ? relativePath : `./${relativePath}`;
    } catch {
      // Preserve the original location when it cannot be resolved against this workspace.
      return model.path;
    }
  }, [model, rootPath]);
  return model?.hunks.length ? (
    <ReviewableDiff
      filename={model.filename}
      path={displayPath}
      hunks={model.hunks}
      className="max-w-none"
    />
  ) : (
    fallback
  );
}
