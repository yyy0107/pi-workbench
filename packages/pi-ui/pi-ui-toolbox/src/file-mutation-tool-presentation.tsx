import { FilePenLineIcon, FilePlus2Icon } from "lucide-react";
import type { ToolPresentationDefinition } from "@workbench/extension-sdk";

import { definePiMessage } from "./i18n";
import { FileMutationToolSummary } from "./file-mutation-tool-summary";
import { fileMutationResourceStats, fileMutationToolModel } from "../lib/file-mutation-tool-model";

const expandable: NonNullable<ToolPresentationDefinition["getExpandable"]> = (block) => {
  const cancelled = block.status === "incomplete" && block.incompleteReason === "cancelled";
  const failed = block.status === "error" || (block.status === "incomplete" && !cancelled);
  return (
    Boolean(
      fileMutationToolModel({
        toolName: block.toolName,
        toolCallId: block.callId,
        args: block.arguments,
        result: block.result,
      }),
    ) ||
    failed ||
    cancelled ||
    block.status === "requires-action"
  );
};

export const editToolPresentation: ToolPresentationDefinition = {
  label: definePiMessage("extensions.fileMutation.edit.complete"),
  activeLabel: definePiMessage("extensions.fileMutation.edit.active"),
  icon: FilePenLineIcon,
  summaryComponent: FileMutationToolSummary,
  getExpandable: expandable,
  showCompletionIcon: false,
  group: "changes",
  getResourceStats: fileMutationResourceStats,
};

export const writeToolPresentation: ToolPresentationDefinition = {
  label: definePiMessage("extensions.fileMutation.write.complete"),
  activeLabel: definePiMessage("extensions.fileMutation.write.active"),
  icon: FilePlus2Icon,
  summaryComponent: FileMutationToolSummary,
  getExpandable: expandable,
  showCompletionIcon: false,
  group: "changes",
  getResourceStats: fileMutationResourceStats,
};
