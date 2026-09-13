"use client";

import { useCallback, useMemo } from "react";
import type { ToolPresentationSummaryProps } from "@workbench/extension-sdk";
import { useI18n } from "@workbench/i18n";
import { ShimmerLabel, useToastManager, withTooltip } from "@workbench/ui";
import { cn } from "@workbench/ui/utils";
import { useOpenerService, useWorkspaceContext } from "@workbench/ui-workspace/react";
import { filesTranslationBundle } from "@workbench/workspace-files/i18n";

import { fileMutationToolModel } from "../lib/file-mutation-tool-model";

export function FileMutationToolSummary({ block, label }: ToolPresentationSummaryProps) {
  const { number } = useI18n(filesTranslationBundle);
  const { t } = useI18n(filesTranslationBundle);
  const { add: addToast } = useToastManager();
  const openers = useOpenerService();
  const workspaceContext = useWorkspaceContext();
  const cancelled = block.status === "incomplete" && block.incompleteReason === "cancelled";
  const failed = block.status === "error" || (block.status === "incomplete" && !cancelled);
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
  const args = block.arguments as Record<string, unknown> | undefined;
  const path = [args?.path, args?.file, args?.filePath, args?.file_path].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const query = model?.filename ?? path?.split(/[\\/]/).filter(Boolean).at(-1) ?? block.toolName;
  const diffId = `file-diff:${workspaceContext.threadId ?? workspaceContext.applicationId}:${block.callId}`;
  const openWorkspaceDiff = useCallback(() => {
    if (!model) return;
    void openers
      .open({
        resource: {
          scheme: "workspace-file",
          path: model.path,
          label: model.filename,
          metadata: { viewMode: "diff", diffId, lines: model.lines },
        },
        context: workspaceContext,
        scope: workspaceContext.threadId
          ? { type: "thread", key: workspaceContext.threadId }
          : { type: "application", key: workspaceContext.applicationId },
        policy: "force-focus",
      })
      .catch(() => {
        addToast({
          id: "workspace-file-open-error",
          type: "error",
          priority: "high",
          title: t("workspaceFiles.fileTree.openError", { name: model.filename }),
        });
      });
  }, [addToast, diffId, model, openers, t, workspaceContext]);

  const queryNode = model ? (
    <button
      type="button"
      title={query}
      className="pointer-events-auto min-w-0 cursor-pointer truncate border-b border-dotted border-foreground/30 bg-transparent text-left leading-tight text-foreground/55 transition-colors group-hover/tool-summary:text-foreground group-focus-within/tool-summary:text-foreground"
      onClick={openWorkspaceDiff}
    >
      {query}
    </button>
  ) : (
    <span
      title={query}
      className="min-w-0 truncate border-b border-dotted border-foreground/30 leading-tight"
    >
      {query}
    </span>
  );

  return (
    <span
      data-slot="file-mutation-tool-summary"
      className={cn(
        "flex min-w-0 items-center gap-1",
        failed && "text-destructive",
        cancelled && "text-muted-foreground",
      )}
    >
      <ShimmerLabel
        active={block.status === "running"}
        className={cn(
          "relative shrink-0 whitespace-nowrap leading-none",
          cancelled && "line-through",
        )}
      >
        {label}
      </ShimmerLabel>
      {withTooltip(queryNode)}
      {model ? (
        <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
          <span className="text-[var(--tool-diff-additions)] transition-colors">
            <span data-diff-marker="">+</span>
            {number(model.additions)}
          </span>
          <span className="text-[var(--tool-diff-deletions)] transition-colors">
            <span data-diff-marker="">-</span>
            {number(model.deletions)}
          </span>
        </span>
      ) : null}
    </span>
  );
}
