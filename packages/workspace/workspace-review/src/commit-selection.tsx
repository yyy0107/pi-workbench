"use client";
import { reviewTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { useEffect, useState } from "react";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";
import type { WorkbenchWorkspaceGitCommit } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
} from "@workbench/ui";

export function CommitSelection({
  workspaceId,
  value,
  label,
  onChange,
}: {
  workspaceId: string;
  value?: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const workspace = useWorkbenchWorkspaceCapability();
  const { t } = useI18n(reviewTranslationBundle);
  const [commits, setCommits] = useState<WorkbenchWorkspaceGitCommit[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void workspace
      ?.readGitLog(workspaceId, { offset, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        setCommits((old) => (offset ? [...old, ...page.commits] : page.commits));
        setMore(page.truncated);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspace, workspaceId, offset, retry]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="max-w-full text-xs" />}
        aria-label={label}
      >
        <span className="truncate">
          {label}
          {value ? ` · ${value.slice(0, 8)}` : ""}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-workspace-review="">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onChange}>
          {commits.map((commit) => (
            <DropdownMenuRadioItem key={commit.hash} value={commit.hash} title={commit.subject}>
              <span className="shrink-0 font-mono">{commit.shortHash}</span>
              <span className="truncate">{commit.subject}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {loading ? (
          <DropdownMenuItem disabled>{t("extensions.workspaceReview.loading")}</DropdownMenuItem>
        ) : failed ? (
          <DropdownMenuItem onClick={() => setRetry((value) => value + 1)}>
            {t("extensions.workspaceReview.retry")}
          </DropdownMenuItem>
        ) : more ? (
          <DropdownMenuItem onClick={() => setOffset(commits.length)}>
            {t("extensions.workspaceReview.loadMore")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
