"use client";

import { ChevronDownIcon, ChevronRightIcon, FileDiffIcon } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import type {
  WorkbenchWorkspaceGitChangedFile,
  WorkbenchWorkspaceGitDiffRequest,
  WorkbenchWorkspaceGitReviewScope,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { defineMessage, useI18n } from "../../../i18n";
import { useRightWorkspace, useWorkspaceContext } from "../../../right-workspace-react";
import {
  Button,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "../../../ui";
import { FileTypeIcon } from "../../../workspace-file-tree";
import type { DiffHunk } from "../../../elements/reviewable-diff";
import { MarkdownPreview } from "../../../chat/markdown-preview";
import { isMarkdownFile } from "../workspace-file/file-view-mode";
import { ReviewDiffHunk } from "./review-diff-hunk";
import { ReviewToolbar } from "./review-toolbar";
import { defaultReviewDisplayOptions, type ReviewDisplayOptions } from "./review-options";
import { parseUnifiedPatch } from "../../../elements/unified-patch";
import { useGitReviewService } from "./git-review-service";
import { CommitSelection } from "./commit-selection";
import { useGitDiff } from "./use-git-diff";

export interface ReviewSurfaceParams extends Record<string, unknown> {
  repositoryId: string;
  reviewScope: WorkbenchWorkspaceGitReviewScope;
  revision?: string;
  baseRevision?: string;
  sessionId?: string;
  displayOptions?: ReviewDisplayOptions;
}

type ReviewProps = WorkspaceSurfaceProps<ReviewSurfaceParams>;

function DiffState({ query }: { query: ReturnType<typeof useGitDiff> }) {
  const { t } = useI18n();
  if (query.error)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 p-3 text-sm text-muted-foreground"
      >
        <span>
          {t(
            query.error === "unavailable"
              ? "extensions.workspaceReview.unavailable"
              : query.error === "stale"
                ? "extensions.workspaceReview.stale"
                : query.error === "too-large"
                  ? "extensions.workspaceReview.tooLarge"
                  : "extensions.workspaceReview.loadFailed",
          )}
        </span>
        {query.error === "failed" && (
          <Button variant="ghost" onClick={query.retry}>
            {t("extensions.workspaceReview.retry")}
          </Button>
        )}
      </div>
    );
  if (query.loading)
    return (
      <p role="status" className="p-3 text-sm text-muted-foreground">
        {t("extensions.workspaceReview.loading")}
      </p>
    );
  if (query.data && !query.data.repository)
    return (
      <p role="status" className="p-3 text-sm text-muted-foreground">
        {t("extensions.workspaceReview.notRepository")}
      </p>
    );
  return null;
}

function MoreDiff({ query }: { query: ReturnType<typeof useGitDiff> }) {
  const { t } = useI18n();
  return query.data?.repository && query.data.nextOffset !== undefined ? (
    <div className="px-3 py-2">
      <p className="text-xs text-muted-foreground">{t("extensions.workspaceReview.partial")}</p>
      <Button
        variant="ghost"
        onClick={query.loadMore}
        disabled={query.loading || Boolean(query.error)}
      >
        {t("extensions.workspaceReview.loadMore")}
      </Button>
    </div>
  ) : null;
}

function FilePatch({
  surface,
  request,
  file,
  options,
}: {
  options: ReviewDisplayOptions;
  surface: ReviewProps["surface"];
  request: WorkbenchWorkspaceGitDiffRequest;
  file: WorkbenchWorkspaceGitChangedFile;
}) {
  const { t } = useI18n();
  const richText = options.richText && isMarkdownFile(file.path);
  const fileRequest = useMemo(
    () => ({ ...request, path: file.path, fullContext: options.fullFile || richText }),
    [request, file.path, options.fullFile, richText],
  );
  const query = useGitDiff(fileRequest);
  const patch = query.data?.repository ? (query.data.patch ?? "") : "";
  const hunks = useMemo(
    () =>
      parseUnifiedPatch(patch).map((hunk, index): DiffHunk => ({
        id: String(index),
        decision: "pending",
        range: `@@ -${hunk.oldStart},${hunk.lines.filter((line) => line.kind !== "added").length} +${hunk.newStart},${hunk.lines.filter((line) => line.kind !== "removed").length} @@`,
        lines: hunk.lines,
      })),
    [patch],
  );
  return (
    <div className="border-y border-border" aria-busy={query.loading}>
      {file.previousPath && (
        <p className="break-all px-3 py-2 text-xs text-muted-foreground">
          {t("extensions.workspaceReview.renamedFrom", { path: file.previousPath })}
        </p>
      )}
      {richText &&
      hunks.length > 0 &&
      query.data?.repository &&
      query.data.nextOffset === undefined &&
      !query.loading &&
      !query.error ? (
        <div className="grid gap-2 p-2">
          {(["old", "new"] as const).map((side) => (
            <section key={side} className="min-w-0 rounded-(--button-radius) border border-border">
              <h3 className="border-b border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
                {t(
                  side === "old"
                    ? "extensions.workspaceReview.before"
                    : "extensions.workspaceReview.after",
                )}
              </h3>
              <MarkdownPreview
                ariaLabel={t(
                  side === "old"
                    ? "extensions.workspaceReview.before"
                    : "extensions.workspaceReview.after",
                )}
                content={hunks
                  .flatMap((hunk) =>
                    hunk.lines
                      .filter((line) => line.kind !== (side === "old" ? "added" : "removed"))
                      .map((line) => line.text),
                  )
                  .join("\n")}
              />
            </section>
          ))}
        </div>
      ) : (
        hunks.map((hunk) => (
          <ReviewDiffHunk
            key={hunk.id}
            hunk={hunk}
            filename={file.path}
            surface={surface}
            request={request}
            options={options}
          />
        ))
      )}
      {!query.loading && !query.error && query.data?.repository && !hunks.length && (
        <p className="p-3 text-sm text-muted-foreground">
          {t(
            file.binary
              ? "extensions.workspaceReview.binary"
              : "extensions.workspaceReview.noTextChanges",
          )}
        </p>
      )}
      {patch.includes("\\ No newline at end of file") && (
        <p className="px-3 py-1 text-xs text-muted-foreground">
          {t("extensions.workspaceReview.noFinalNewline")}
        </p>
      )}
      <DiffState query={query} />
      <MoreDiff query={query} />
    </div>
  );
}

function ReviewFile({
  file,
  surface,
  request,
  options,
}: {
  options: ReviewDisplayOptions;
  file: WorkbenchWorkspaceGitChangedFile;
  surface: ReviewProps["surface"];
  request: WorkbenchWorkspaceGitDiffRequest;
}) {
  const { t, number } = useI18n();
  const [open, setOpen] = useState(false);
  const slash = file.path.lastIndexOf("/") + 1;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="w-full min-w-0 justify-start gap-2 text-xs font-normal"
          />
        }
        title={file.path}
      >
        {open ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
        <FileTypeIcon path={file.path} className="size-(--icon-size-md) shrink-0" />
        <span className="flex min-w-0 flex-1 font-mono text-left">
          <span className="min-w-0 truncate text-muted-foreground">
            {file.path.slice(0, slash)}
          </span>
          <span className="max-w-full shrink-0 truncate text-foreground">
            {file.path.slice(slash)}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">
          {t(`extensions.workspaceReview.change.${file.kind}`)}
        </span>
        {file.binary ? (
          <span className="shrink-0 text-muted-foreground">
            {t("extensions.workspaceReview.binaryShort")}
          </span>
        ) : file.additions !== undefined && file.deletions !== undefined ? (
          <span
            className="flex shrink-0 gap-1 font-mono tabular-nums"
            aria-label={t("extensions.workspaceReview.lineChanges", {
              additions: file.additions,
              deletions: file.deletions,
            })}
          >
            <span className="text-success-foreground/80" aria-hidden>
              +{number(file.additions)}
            </span>
            <span className="text-danger-foreground/80" aria-hidden>
              −{number(file.deletions)}
            </span>
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {open && (
          <FilePatch
            key={`${options.fullFile}:${options.richText}`}
            surface={surface}
            request={request}
            file={file}
            options={options}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReviewComparison({ surface, refresh }: ReviewProps & { refresh: () => void }) {
  const { t, date, number } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const isCommit =
    surface.params.reviewScope === "commit" || surface.params.reviewScope === "range";
  const options = { ...defaultReviewDisplayOptions, ...surface.params.displayOptions };
  const supported =
    !isCommit ||
    Boolean(
      surface.params.revision &&
      (surface.params.reviewScope !== "range" || surface.params.baseRevision),
    );
  const request = useMemo(
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
  const query = useGitDiff(request, supported);
  const repository = query.data?.repository ? query.data : undefined;
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
      reviewScope: branch ? "branch" : (value as WorkbenchWorkspaceGitReviewScope),
      sessionId: context.threadId,
      displayOptions: options,
      ...(branch ? { revision: target } : {}),
    });
  };
  return (
    <section data-workspace-review="" className="flex h-full min-h-0 flex-col text-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" className="min-w-0 shrink px-0 font-normal" />}
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
            <span className="text-success-foreground/80" aria-hidden>
              +{number(totals.additions)}
            </span>
            <span className="text-danger-foreground/80" aria-hidden>
              −{number(totals.deletions)}
            </span>
          </span>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1 text-muted-foreground">
          <ReviewToolbar
            request={request}
            options={options}
            refresh={refresh}
            canCopy={Boolean(repository?.files.length) && !query.loading && !query.error}
            onChange={(displayOptions) =>
              controller.update(surface.id, { params: { ...surface.params, displayOptions } })
            }
          />
        </div>
      </div>
      {request.scope === "branch" && (
        <div className="flex min-w-0 items-center border-b border-border px-2 py-1">
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={repository?.branch}
          >
            {repository?.branch}
          </span>
          <ChevronRightIcon
            aria-hidden
            className="size-(--icon-size-sm) shrink-0 text-muted-foreground"
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" className="min-w-0 shrink text-xs" />}
              aria-label={t("extensions.workspaceReview.compareBranch")}
            >
              <span className="truncate">{request.revision}</span>
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent data-workspace-review="" className="max-h-80 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={request.revision}
                onValueChange={(revision) => reveal({ ...surface.params, revision })}
              >
                {repository?.branches.map((branch) => (
                  <DropdownMenuRadioItem key={branch} value={branch}>
                    {branch}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {isCommit && (
        <div className="flex flex-wrap border-b border-border px-2 py-1">
          {surface.params.reviewScope === "range" && (
            <CommitSelection
              workspaceId={request.workspaceId}
              value={request.baseRevision}
              label={t("extensions.workspaceReview.firstCommit")}
              onChange={(baseRevision) => reveal({ ...surface.params, baseRevision })}
            />
          )}
          <CommitSelection
            workspaceId={request.workspaceId}
            value={request.revision}
            label={t(
              surface.params.reviewScope === "range"
                ? "extensions.workspaceReview.lastCommit"
                : "extensions.workspaceReview.chooseCommit",
            )}
            onChange={(revision) => reveal({ ...surface.params, revision })}
          />
        </div>
      )}
      {(request.scope === "session" || request.scope === "last-turn") && (
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          {t("extensions.workspaceReview.snapshotHint")}
        </p>
      )}
      {request.scope === "last-turn" && Boolean(repository?.turns?.length) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" className="w-full justify-start text-xs" />}
          >
            {date(
              repository!.turns!.find((turn) => turn.id === request.revision)?.timestamp ??
                repository!.turns!.at(-1)!.timestamp,
              { dateStyle: "short", timeStyle: "medium" },
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent data-workspace-review="" className="max-h-80 overflow-y-auto">
            <DropdownMenuRadioGroup
              value={request.revision ?? repository!.turns!.at(-1)!.id}
              onValueChange={(revision) => reveal({ ...surface.params, revision })}
            >
              {repository?.turns?.toReversed().map((turn) => (
                <DropdownMenuRadioItem key={turn.id} value={turn.id}>
                  {date(turn.timestamp, { dateStyle: "short", timeStyle: "medium" })}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1" aria-busy={query.loading}>
        {supported ? (
          <>
            {repository?.files.map((file) => (
              <ReviewFile
                key={file.path}
                file={file}
                surface={surface}
                request={request}
                options={options}
              />
            ))}
            {!query.loading && !query.error && repository?.files.length === 0 && (
              <div
                role="status"
                className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground"
              >
                <FileDiffIcon aria-hidden className="size-(--icon-size-lg)" />
                {t(
                  repository.unrecorded
                    ? "extensions.workspaceReview.unrecorded"
                    : "extensions.workspaceReview.empty",
                )}
              </div>
            )}
            <DiffState query={query} />
            <MoreDiff query={query} />
          </>
        ) : (
          <p role="status" className="p-3 text-sm text-muted-foreground">
            {t("extensions.workspaceReview.chooseCommitsHint")}
          </p>
        )}
      </div>
    </section>
  );
}

export function ReviewSurface(props: ReviewProps) {
  const changes = useGitReviewService();
  const controller = useRightWorkspace();
  useEffect(() => {
    controller.update(props.surface.id, { status: "ready", statusMessage: undefined });
  }, [controller, props.surface.id, props.retryToken]);
  const revision = useSyncExternalStore(
    changes.subscribe,
    () => changes.getRevision(props.surface.params.repositoryId),
    () => 0,
  );
  const [refresh, setRefresh] = useState(0);
  return (
    <ReviewComparison
      key={`${props.surface.resourceKey}:${revision}:${props.retryToken ?? 0}:${refresh}`}
      {...props}
      refresh={() => setRefresh((value) => value + 1)}
    />
  );
}
