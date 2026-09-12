"use client";

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
} from "../../../ui";
import { useCopyFeedback } from "../../../hooks/use-clipboard-copy";
import { writeClipboardText } from "../../../clipboard";
import { useI18n } from "../../../i18n";
import { gitApplyCommand, readReviewPatch, type ReviewDisplayOptions } from "./review-options";

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
  const { t } = useI18n();
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
        <DropdownMenuContent data-workspace-review="">
          <DropdownMenuItem onClick={refresh}>
            <RefreshCwIcon />
            {t("extensions.workspaceReview.refresh")}
          </DropdownMenuItem>
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
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t(
          filesExpanded
            ? "extensions.workspaceReview.collapseAllFiles"
            : "extensions.workspaceReview.expandAllFiles",
        )}
        title={t(
          filesExpanded
            ? "extensions.workspaceReview.collapseAllFiles"
            : "extensions.workspaceReview.expandAllFiles",
        )}
        aria-expanded={filesExpanded}
        onClick={onToggleFiles}
      >
        {filesExpanded ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t(
          options.fullFile
            ? "extensions.workspaceReview.disableFullFile"
            : "extensions.workspaceReview.enableFullFile",
        )}
        title={t(
          options.fullFile
            ? "extensions.workspaceReview.disableFullFile"
            : "extensions.workspaceReview.enableFullFile",
        )}
        aria-pressed={options.fullFile}
        onClick={() => toggle("fullFile")}
      >
        <GitCommitIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t(
          options.richText
            ? "extensions.workspaceReview.disableRichText"
            : "extensions.workspaceReview.enableRichText",
        )}
        title={t(
          options.richText
            ? "extensions.workspaceReview.disableRichText"
            : "extensions.workspaceReview.enableRichText",
        )}
        aria-pressed={options.richText}
        onClick={() => toggle("richText")}
      >
        <UploadIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("extensions.workspaceReview.copyApply")}
        title={t("extensions.workspaceReview.copyApply")}
        disabled={!canCopy || pending}
        onClick={copy}
      >
        <CopyIcon />
      </Button>
    </>
  );
}
