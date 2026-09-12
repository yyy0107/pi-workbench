"use client";

import { ChevronDownIcon } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import type { WorkbenchWorkspaceGitDiffRequest } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { defineMessage, useI18n } from "../../../i18n";
import { useRightWorkspace } from "../../../right-workspace-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../ui";
import { ReviewToolbar } from "./review-toolbar";
import { defaultReviewDisplayOptions } from "./review-options";
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
  const { t, number } = useI18n();
  const controller = useRightWorkspace();
  const isCommit =
    surface.params.reviewScope === "commit" || surface.params.reviewScope === "range";
  const options = { ...defaultReviewDisplayOptions, ...surface.params.displayOptions };
  const request = useMemo<WorkbenchWorkspaceGitDiffRequest>(
    () => ({
      workspaceId: surface.params.repositoryId,
      scope: surface.params.reviewScope,
      revision: surface.params.reviewScope === "last-turn" ? undefined : surface.params.revision,
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
  const filesExpanded = surface.params.filesExpanded === true;
  const totals = repository?.files.reduce(
    (sum, file) => ({
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
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
      sessionId: context.threadId,
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
          render={<Button variant="ghost" className="w-fit min-w-0 shrink px-2.5 font-normal" />}
          aria-label={t("extensions.workspaceReview.scopeLabel")}
          title={repository?.branch}
        >
          <span className="truncate">
            {t(`extensions.workspaceReview.scope.${surface.params.reviewScope}`)}
          </span>
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80 overflow-y-auto" data-workspace-review="">
          <DropdownMenuRadioGroup value={selection} onValueChange={select}>
            <DropdownMenuRadioItem value="last-turn" disabled={!context.threadId}>
              {t("extensions.workspaceReview.scope.last-turn")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="session" disabled={!context.threadId}>
              {t("extensions.workspaceReview.scope.session")}
            </DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="uncommitted">
              {t("extensions.workspaceReview.scope.uncommitted")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="unstaged">
              {t("extensions.workspaceReview.scope.unstaged")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="staged">
              {t("extensions.workspaceReview.scope.staged")}
            </DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {t("extensions.workspaceReview.committed")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-workspace-review="">
                <DropdownMenuRadioGroup value={selection} onValueChange={select}>
                  <DropdownMenuRadioItem value="commit">
                    {t("extensions.workspaceReview.scope.commit")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="range">
                    {t("extensions.workspaceReview.scope.range")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuRadioItem value="branch" disabled={!repository?.branches.length}>
              {t("extensions.workspaceReview.scope.branch")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {totals && (
        <span
          className="flex shrink-0 gap-1 text-sm tabular-nums"
          aria-label={t("extensions.workspaceReview.lineChanges", totals)}
          title={
            repository?.nextOffset !== undefined
              ? t("extensions.workspaceReview.partial")
              : undefined
          }
        >
          <span className="text-success-foreground" aria-hidden>
            +{number(totals.additions)}
          </span>
          <span className="text-danger-foreground" aria-hidden>
            −{number(totals.deletions)}
          </span>
        </span>
      )}
      <div className="ms-auto flex min-w-0 items-center gap-1 text-muted-foreground">
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
