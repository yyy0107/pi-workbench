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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@workbench/ui";

interface CommitMenuProps {
  workspaceId: string;
  value?: string;
  onChange: (value: string, commit: WorkbenchWorkspaceGitCommit) => void;
}

function CommitMenuItems({
  workspaceId,
  value,
  onChange,
  showShortHash = false,
}: CommitMenuProps & { showShortHash?: boolean }) {
  const workspace = useWorkbenchWorkspaceCapability();
  const { t, date, relativeTime } = useI18n(reviewTranslationBundle);
  const [commits, setCommits] = useState<WorkbenchWorkspaceGitCommit[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void workspace
      .readGitLog(workspaceId, { offset, signal: controller.signal })
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

  if (!workspace) {
    return (
      <DropdownMenuItem disabled>{t("extensions.workspaceReview.unavailable")}</DropdownMenuItem>
    );
  }

  return (
    <>
      <DropdownMenuRadioGroup
        value={value ?? ""}
        onValueChange={(hash) => {
          const commit = commits.find((entry) => entry.hash === hash);
          if (commit) onChange(hash, commit);
        }}
      >
        {commits.map((commit) => {
          const timestamp = new Date(commit.authoredAt);
          const validTime = Number.isFinite(timestamp.getTime());
          const minutes = Math.max(0, Math.floor((Date.now() - timestamp.getTime()) / 60_000));
          const timeLabel = !validTime
            ? undefined
            : minutes < 60
              ? relativeTime(-minutes, "minute")
              : minutes < 24 * 60
                ? relativeTime(-Math.floor(minutes / 60), "hour")
                : relativeTime(-Math.floor(minutes / (24 * 60)), "day");
          return (
            <DropdownMenuRadioItem key={commit.hash} value={commit.hash} title={commit.subject}>
              {showShortHash && <span className="shrink-0 font-mono">{commit.shortHash}</span>}
              <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
              {timeLabel && (
                <time
                  dateTime={commit.authoredAt}
                  title={date(timestamp, { dateStyle: "medium", timeStyle: "short" })}
                  className="ms-auto shrink-0 text-xs text-muted-foreground"
                >
                  {timeLabel}
                </time>
              )}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      {loading ? (
        <DropdownMenuItem disabled>
          {t("extensions.workspaceReview.loadingCommits")}
        </DropdownMenuItem>
      ) : failed ? (
        <>
          <div role="alert" className="px-2.5 py-2 text-sm text-muted-foreground">
            {t("extensions.workspaceReview.commitsLoadFailed")}
          </div>
          <DropdownMenuItem closeOnClick={false} onClick={() => setRetry((value) => value + 1)}>
            {t("extensions.workspaceReview.retry")}
          </DropdownMenuItem>
        </>
      ) : more ? (
        <DropdownMenuItem closeOnClick={false} onClick={() => setOffset(commits.length)}>
          {t("extensions.workspaceReview.loadMore")}
        </DropdownMenuItem>
      ) : commits.length === 0 ? (
        <DropdownMenuItem disabled>{t("extensions.workspaceReview.noCommits")}</DropdownMenuItem>
      ) : null}
    </>
  );
}

export function CommitSubmenu(props: CommitMenuProps) {
  const { t } = useI18n(reviewTranslationBundle);
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger>{t("extensions.workspaceReview.committed")}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent data-workspace-review="">
        {open && <CommitMenuItems key={props.workspaceId} {...props} />}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function CommitSelection({
  workspaceId,
  value,
  label,
  onChange,
}: CommitMenuProps & { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
        {open && (
          <CommitMenuItems
            key={workspaceId}
            workspaceId={workspaceId}
            value={value}
            onChange={onChange}
            showShortHash
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
