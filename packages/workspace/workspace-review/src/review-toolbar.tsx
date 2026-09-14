"use client";
import { reviewTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { useEffect, useRef, useState } from "react";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  EllipsisIcon,
  GitCommitIcon,
  PilcrowIcon,
  RefreshCwIcon,
  TextCursorInputIcon,
  WrapTextIcon,
  UploadIcon,
} from "lucide-react";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";
import type { WorkbenchWorkspaceGitDiffRequest } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@workbench/ui";
import { useCopyFeedback } from "@workbench/ui/hooks";
import { writeClipboardText } from "@workbench/ui/clipboard";

import { gitApplyCommand, readReviewPatch, type ReviewDisplayOptions } from "../lib/review-options";

export function ReviewToolbar({
  request,
  options,
  onChange,
  refresh,
  canCopy,
  filesExpanded,
  onToggleFiles,
}: {
  request: WorkbenchWorkspaceGitDiffRequest;
  options: ReviewDisplayOptions;
  onChange: (options: ReviewDisplayOptions) => void;
  refresh: () => void;
  canCopy: boolean;
  filesExpanded: boolean;
  onToggleFiles: () => void;
}) {
  const { t } = useI18n(reviewTranslationBundle);
  const workspace = useWorkbenchWorkspaceCapability();
  const { runCopy, status } = useCopyFeedback();
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const copy = () => {
    if (!workspace || pending) return;
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    void runCopy(async () => {
      const patch = await readReviewPatch(workspace, request, current.signal);
      current.signal.throwIfAborted();
      return writeClipboardText(gitApplyCommand(patch));
    }).finally(() => {
      if (!current.signal.aborted) setPending(false);
    });
  };
  const toggle = (key: keyof ReviewDisplayOptions) =>
    onChange({
      ...options,
      [key]: !options[key],
      ...(key === "fullFile" && options.fullFile ? { richText: false } : {}),
      ...(key === "richText" && !options.richText ? { fullFile: true } : {}),
    });
  return (
    <>
      {(pending || status !== "idle") && (
        <span role="status" className="truncate text-xs text-muted-foreground">
          {t(
            pending
              ? "extensions.workspaceReview.copying"
              : status === "copied"
                ? "extensions.workspaceReview.copied"
                : "extensions.workspaceReview.copyFailed",
          )}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={t("extensions.workspaceReview.more")}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-workspace-review=""
          align="end"
          reserveScrollbarSpace={false}
          limitHeight={false}
        >
          <DropdownMenuItem onClick={() => toggle("wrap")}>
            <WrapTextIcon />
            {t(
              options.wrap
                ? "extensions.workspaceReview.disableWrap"
                : "extensions.workspaceReview.enableWrap",
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => toggle("wordDiff")}>
            <TextCursorInputIcon />
            {t(
              options.wordDiff
                ? "extensions.workspaceReview.disableWordDiff"
                : "extensions.workspaceReview.enableWordDiff",
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggle("whitespace")}>
            <PilcrowIcon />
            {t(
              options.whitespace
                ? "extensions.workspaceReview.hideWhitespace"
                : "extensions.workspaceReview.showWhitespace",
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onToggleFiles}>
            {filesExpanded ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
            {t(
              filesExpanded
                ? "extensions.workspaceReview.collapseAllFiles"
                : "extensions.workspaceReview.expandAllFiles",
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggle("fullFile")}>
            <GitCommitIcon />
            {t(
              options.fullFile
                ? "extensions.workspaceReview.disableFullFile"
                : "extensions.workspaceReview.enableFullFile",
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggle("richText")}>
            <UploadIcon />
            {t(
              options.richText
                ? "extensions.workspaceReview.disableRichText"
                : "extensions.workspaceReview.enableRichText",
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!canCopy || pending} onClick={copy}>
            <CopyIcon />
            {t("extensions.workspaceReview.copyApply")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" className="shrink-0 font-normal" onClick={refresh}>
        <RefreshCwIcon />
        {t("extensions.workspaceReview.refresh")}
      </Button>
    </>
  );
}
