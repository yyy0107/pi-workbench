"use client";

import { useMemo } from "react";
import { ReviewableDiff } from "@workbench/code-highlighting";
import type { ToolRendererProps } from "@workbench/extension-sdk";

import { fileMutationToolModel } from "../lib/file-mutation-tool-model";

export function FileMutationToolRenderer({ block, fallback }: ToolRendererProps) {
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
  return model?.hunks.length ? (
    <ReviewableDiff filename={model.filename} hunks={model.hunks} className="max-w-none" />
  ) : (
    fallback
  );
}
