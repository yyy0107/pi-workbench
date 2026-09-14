"use client";
import { reviewTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { ChevronDownIcon } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import type { WorkbenchWorkspaceGitDiffRequest } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { defineReviewMessage as defineMessage } from "./i18n";

import { useRightWorkspace } from "@workbench/ui-workspace/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workbench/ui";
import { ReviewToolbar } from "./review-toolbar";
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
  const { t } = useI18n(reviewTranslationBundle);
  const controller = useRightWorkspace();
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
        <DropdownMenuContent className="w-max" data-workspace-review="">
          <DropdownMenuRadioGroup value={selection} onValueChange={select}>
            <DropdownMenuRadioItem value="unstaged">
              {t("extensions.workspaceReview.scope.unstaged")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="staged">
              {t("extensions.workspaceReview.scope.staged")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="branch" disabled={!repository?.branches.length}>
              {t("extensions.workspaceReview.scope.branch")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="last-turn" disabled={!context.threadId}>
              {t("extensions.workspaceReview.scope.last-turn")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
