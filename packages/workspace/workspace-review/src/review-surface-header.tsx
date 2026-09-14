"use client";
import { reviewTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import type { WorkbenchWorkspaceGitDiffRequest } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { defineReviewMessage as defineMessage } from "./i18n";

import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";

import { useRightWorkspace } from "@workbench/ui-workspace/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workbench/ui";
import { ReviewToolbar } from "./review-toolbar";
import { CommitSubmenu } from "./commit-selection";
import { defaultReviewDisplayOptions } from "../lib/review-options";
import { useGitDiff } from "./use-git-diff";
import { useGitReviewService } from "./git-review-service";
import type { ReviewSurfaceParams } from "./review-surface";

type ReviewProps = WorkspaceSurfaceProps<ReviewSurfaceParams>;

function ReviewSurfaceHeaderContent({
  surface,
  context,
  refresh,
  reviewRevision,
}: ReviewProps & { refresh(): void; reviewRevision: number }) {
  const { t, number } = useI18n(reviewTranslationBundle);
  const controller = useRightWorkspace();
  const workspace = useWorkbenchWorkspaceCapability();
  const [isGitRepository, setGitRepository] = useState<boolean>();
  useEffect(() => {
    const controller = new AbortController();
    setGitRepository(undefined);
    if (workspace) {
      // Session snapshots can return diff data even outside a Git repository.
      // Only the workspace status identifies which Git scopes are available.
      void workspace
        .describeGit(surface.params.repositoryId, { signal: controller.signal })
        .then((status) => {
          if (!controller.signal.aborted) setGitRepository(status.repository);
        })
        .catch(() => {
          // Keep Git-only actions hidden until the workspace can be verified.
          if (!controller.signal.aborted) setGitRepository(undefined);
        });
    }
    return () => controller.abort();
  }, [workspace, surface.params.repositoryId, reviewRevision]);
  const isCommit =
    surface.params.reviewScope === "commit" || surface.params.reviewScope === "range";
  const options = { ...defaultReviewDisplayOptions, ...surface.params.displayOptions };
  const request = useMemo<WorkbenchWorkspaceGitDiffRequest>(
    () => ({
      workspaceId: surface.params.repositoryId,
      scope: surface.params.reviewScope,
      revision: surface.params.revision,
      baseRevision: surface.params.baseRevision,
      sessionId: surface.params.sessionId ?? context.threadId,
    }),
    [
      surface.params.repositoryId,
      surface.params.reviewScope,
      surface.params.revision,
      surface.params.baseRevision,
      surface.params.sessionId,
      context.threadId,
    ],
  );
  const supported =
    !isCommit ||
    Boolean(
      surface.params.revision &&
      (surface.params.reviewScope !== "range" || surface.params.baseRevision),
    );
  const query = useGitDiff(request, supported, `${surface.resourceKey}:${reviewRevision}`);
  const repository = query.data?.repository ? query.data : undefined;
  const summaryLabel = isCommit
    ? (surface.params.revisionSubject ?? surface.params.revision?.slice(0, 8))
    : surface.params.reviewScope === "branch"
      ? surface.params.revision
      : undefined;
  const { loading, error, loadMore } = query;
  useEffect(() => {
    if (summaryLabel && repository?.nextOffset !== undefined && !loading && !error) loadMore();
  }, [summaryLabel, repository?.nextOffset, loading, error, loadMore]);
  const totals = useMemo(() => {
    if (!repository || repository.nextOffset !== undefined || loading || error) return undefined;
    return repository.files.reduce(
      (sum, file) => ({
        additions: sum.additions + (file.additions ?? 0),
        deletions: sum.deletions + (file.deletions ?? 0),
      }),
      { additions: 0, deletions: 0 },
    );
  }, [repository, loading, error]);
  const filesExpanded = surface.params.filesExpanded === true;
  const selection = surface.params.reviewScope;
  const reveal = (params: ReviewSurfaceParams) => {
    const id = controller.reveal({
      kind: "review",
      title: defineMessage("extensions.workspaceReview.title"),
      params,
      context,
    });
    if (id !== surface.id) controller.close(surface.id, context);
  };
  const select = (value: string) => {
    const branch = value === "branch" || value.startsWith("branch:");
    const target =
      value === "branch"
        ? (repository?.branches.find((name) => name !== repository.branch) ??
          repository?.branches[0])
        : value.slice(7);
    reveal({
      repositoryId: surface.params.repositoryId,
      reviewScope: branch ? "branch" : (value as ReviewSurfaceParams["reviewScope"]),
      sessionId: request.sessionId,
      displayOptions: options,
      ...(branch ? { revision: target } : {}),
    });
  };

  return (
    <div
      data-workspace-review=""
      className="flex size-full min-w-0 items-center gap-2 px-2 text-xs"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" className="w-fit shrink-0 px-2.5 font-normal" />}
          aria-label={t("extensions.workspaceReview.scopeLabel")}
          title={repository?.branch}
        >
          <span className="truncate">
            {t(
              surface.params.reviewScope === "commit"
                ? "extensions.workspaceReview.committed"
                : `extensions.workspaceReview.scope.${surface.params.reviewScope}`,
            )}
          </span>
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-workspace-review=""
          reserveScrollbarSpace={false}
          limitHeight={false}
        >
          <DropdownMenuRadioGroup value={selection} onValueChange={select}>
            <DropdownMenuRadioItem value="last-turn" disabled={!request.sessionId}>
              {t("extensions.workspaceReview.scope.last-turn")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="session" disabled={!request.sessionId}>
              {t("extensions.workspaceReview.scope.session")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {isGitRepository === true && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={selection} onValueChange={select}>
                <DropdownMenuRadioItem value="unstaged">
                  {t("extensions.workspaceReview.scope.unstaged")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="staged">
                  {t("extensions.workspaceReview.scope.staged")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <CommitSubmenu
                workspaceId={surface.params.repositoryId}
                value={
                  surface.params.reviewScope === "commit" ? surface.params.revision : undefined
                }
                onChange={(revision, commit) =>
                  reveal({
                    repositoryId: surface.params.repositoryId,
                    reviewScope: "commit",
                    revision,
                    revisionSubject: commit.subject,
                    sessionId: request.sessionId,
                    displayOptions: options,
                  })
                }
              />
              <DropdownMenuRadioGroup value={selection} onValueChange={select}>
                <DropdownMenuRadioItem value="branch" disabled={!repository?.branches.length}>
                  {t("extensions.workspaceReview.scope.branch")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {summaryLabel && (
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 truncate text-muted-foreground" title={summaryLabel}>
            {summaryLabel}
          </span>
          {totals && (
            <span
              className="flex shrink-0 gap-1 tabular-nums"
              aria-label={t("extensions.workspaceReview.lineChanges", totals)}
            >
              <span className="text-success-foreground" aria-hidden>
                +{number(totals.additions)}
              </span>
              <span className="text-danger-foreground" aria-hidden>
                −{number(totals.deletions)}
              </span>
            </span>
          )}
        </div>
      )}
      <div className="ms-auto flex shrink-0 items-center gap-1 text-muted-foreground">
        <ReviewToolbar
          request={request}
          options={options}
          refresh={refresh}
          canCopy={Boolean(repository?.files.length) && !query.loading && !query.error}
          filesExpanded={filesExpanded}
          onToggleFiles={() =>
            controller.update(surface.id, {
              params: { ...surface.params, filesExpanded: !filesExpanded },
            })
          }
          onChange={(displayOptions) =>
            controller.update(surface.id, { params: { ...surface.params, displayOptions } })
          }
        />
      </div>
    </div>
  );
}

export function ReviewSurfaceHeader(props: ReviewProps) {
  const changes = useGitReviewService();
  const revision = useSyncExternalStore(
    changes.subscribe,
    () => changes.getRevision(props.surface.params.repositoryId),
    () => 0,
  );
  return (
    <ReviewSurfaceHeaderContent
      key={`${props.surface.resourceKey}:${revision}`}
      {...props}
      reviewRevision={revision}
      refresh={() => changes.noteChanged(props.surface.params.repositoryId)}
    />
  );
}
