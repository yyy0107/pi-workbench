"use client";
import { filesTranslationBundle } from "@workbench/workspace-files/i18n";
import { reviewTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  FileCode2Icon,
  FileDiffIcon,
  GitBranchIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import type {
  WorkbenchWorkspaceGitChangedFile,
  WorkbenchWorkspaceGitDiffRequest,
  WorkbenchWorkspaceGitReviewScope,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { defineReviewMessage as defineMessage } from "./i18n";

import {
  useOpenerService,
  useRightWorkspace,
  useWorkspaceContext,
} from "@workbench/ui-workspace/react";
import {
  Button,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  useToastManager,
  PathEllipsis,
} from "@workbench/ui";
import {
  SearchableSelector,
  SearchableSelectorCollection,
  SearchableSelectorContent,
  SearchableSelectorEmpty,
  SearchableSelectorGroup,
  SearchableSelectorGroupLabel,
  SearchableSelectorSearch,
  SearchableSelectorItem,
  SearchableSelectorList,
  SearchableSelectorTrigger,
} from "@workbench/ui-selectors";
import { useClipboardCopy } from "@workbench/ui/hooks";
import { FileTypeIcon } from "@workbench/ui-file-presentation/icons";
import { workspaceAbsolutePath } from "@workbench/workspace-files";
import type { DiffHunk } from "@workbench/code-highlighting";
import { MarkdownPreview } from "@workbench/markdown";
import { shouldHighlightWorkbenchCode } from "@workbench/code-highlighting";
import { languageForFilename } from "@workbench/code-highlighting";
import { useWorkbenchHighlightedLines } from "@workbench/code-highlighting";
import { isMarkdownFile } from "@workbench/workspace-files/classification";
import { ReviewDiffHunk } from "./review-diff-hunk";
import { defaultReviewDisplayOptions, type ReviewDisplayOptions } from "../lib/review-options";
import { parseUnifiedPatch } from "@workbench/code-highlighting";
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
  filesExpanded?: boolean;
}

type ReviewProps = WorkspaceSurfaceProps<ReviewSurfaceParams>;

function DiffState({ query }: { query: ReturnType<typeof useGitDiff> }) {
  const { t } = useI18n(reviewTranslationBundle);
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
  const { t } = useI18n(reviewTranslationBundle);
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

const FilePatch = memo(function FilePatch({
  request,
  file,
  options,
  cacheKey,
}: {
  options: ReviewDisplayOptions;
  request: WorkbenchWorkspaceGitDiffRequest;
  file: WorkbenchWorkspaceGitChangedFile;
  cacheKey: string;
}) {
  const { t } = useI18n(reviewTranslationBundle);
  const richText = options.richText && isMarkdownFile(file.path);
  const fileRequest = useMemo(
    () => ({ ...request, path: file.path, fullContext: options.fullFile || richText }),
    [request, file.path, options.fullFile, richText],
  );
  const query = useGitDiff(fileRequest, true, cacheKey);
  const patch = query.data?.repository ? (query.data.patch ?? "") : "";
  const parsedHunks = useMemo(() => parseUnifiedPatch(patch), [patch]);
  const hunks = useMemo(
    () =>
      parsedHunks.map((hunk, index): DiffHunk => ({
        id: String(index),
        decision: "pending",
        range: `@@ -${hunk.oldStart},${hunk.lines.filter((line) => line.kind !== "added").length} +${hunk.newStart},${hunk.lines.filter((line) => line.kind !== "removed").length} @@`,
        lines: hunk.lines,
        hiddenContextBefore:
          index === 0
            ? Math.max(0, hunk.oldStart - 1)
            : Math.max(
                0,
                hunk.oldStart -
                  parsedHunks[index - 1].oldStart -
                  parsedHunks[index - 1].lines.filter((line) => line.kind !== "added").length,
              ),
      })),
    [parsedHunks],
  );
  const gutterWidth = useMemo(() => {
    const maximumLine = parsedHunks.reduce(
      (maximum, hunk) =>
        Math.max(maximum, hunk.oldStart + hunk.lines.length, hunk.newStart + hunk.lines.length),
      1,
    );
    return `${Math.max(3, String(maximumLine).length) + 2}ch`;
  }, [parsedHunks]);
  const highlightCode = useMemo(
    () => (richText ? "" : hunks.flatMap((hunk) => hunk.lines.map((line) => line.text)).join("\n")),
    [hunks, richText],
  );
  const highlightEnabled = useMemo(
    () => Boolean(highlightCode) && shouldHighlightWorkbenchCode(highlightCode),
    [highlightCode],
  );
  const highlightLanguage = useMemo(() => languageForFilename(file.path), [file.path]);
  const { tokens: highlightedTokens } = useWorkbenchHighlightedLines(
    highlightCode,
    highlightLanguage,
    {
      enabled: highlightEnabled,
    },
  );
  const tokensByHunk = useMemo(() => {
    if (!highlightedTokens) return undefined;
    let lineOffset = 0;
    return hunks.map((hunk) => {
      const tokens = highlightedTokens.slice(lineOffset, lineOffset + hunk.lines.length);
      lineOffset += hunk.lines.length;
      return tokens;
    });
  }, [hunks, highlightedTokens]);
  return (
    <div className="min-w-0 pb-2" aria-busy={query.loading}>
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
                content={parsedHunks
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
        <div className="review-file-scroll min-w-0 overflow-x-auto">
          <div
            data-review-file-code=""
            data-wrap={options.wrap || undefined}
            style={{ "--review-gutter-width": gutterWidth } as CSSProperties}
          >
            {hunks.map((hunk, index) => (
              <ReviewDiffHunk
                key={hunk.id}
                hunk={hunk}
                options={options}
                tokens={tokensByHunk?.[index]}
              />
            ))}
          </div>
        </div>
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
});

const ReviewFile = memo(function ReviewFile({
  file,
  surface,
  request,
  options,
  context,
  filesExpanded,
  cacheKey,
}: {
  options: ReviewDisplayOptions;
  file: WorkbenchWorkspaceGitChangedFile;
  surface: ReviewProps["surface"];
  request: WorkbenchWorkspaceGitDiffRequest;
  context: ReviewProps["context"];
  filesExpanded: boolean;
  cacheKey: string;
}) {
  const { t, number } = useI18n(reviewTranslationBundle);
  const { t: filesT } = useI18n(filesTranslationBundle);
  const openers = useOpenerService();
  const notifications = useToastManager();
  const { copy, status: copyStatus } = useClipboardCopy();
  const [isOpen, setOpen] = useState(filesExpanded);
  useEffect(() => {
    setOpen(filesExpanded);
  }, [filesExpanded]);
  const fileName = file.path.split(/[\\/]/).filter(Boolean).at(-1) ?? file.path;
  const displayPath = workspaceAbsolutePath(context.rootPath, file.path);
  const copyPathLabel =
    copyStatus === "copied"
      ? t("extensions.workspaceReview.fileActions.pathCopied")
      : copyStatus === "failed"
        ? t("extensions.workspaceReview.fileActions.pathCopyFailed")
        : t("extensions.workspaceReview.fileActions.copyPath");
  const openFileTab = () => {
    void openers
      .open({
        resource: { scheme: "workspace-file", path: file.path, label: fileName },
        context,
        scope: surface.scope,
        policy: "force-focus",
      })
      .catch(() => {
        notifications.add({
          id: "workspace-review-file-open-error",
          type: "error",
          priority: "high",
          title: filesT("workspaceFiles.fileTree.openError", { name: fileName }),
        });
      });
  };
  return (
    <Collapsible open={isOpen} onOpenChange={setOpen}>
      <div className="flex min-w-0 items-center rounded-(--button-radius) hover:bg-(--button-background-hover) focus-within:bg-(--button-background-hover) active:bg-(--button-background-active)">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              data-selection="none"
              data-frame="none"
              className="min-w-0 flex-1 shrink justify-start gap-2 text-sm font-normal"
            />
          }
          title={displayPath}
        >
          <FileTypeIcon path={file.path} className="size-(--icon-size-md) shrink-0" />
          <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className="min-w-0 truncate text-foreground">{fileName}</span>
            <PathEllipsis
              text={`./${file.path.replaceAll("\\", "/").replace(/^\.\//, "")}`}
              className="shrink text-muted-foreground"
            />
          </span>
          {file.binary ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {t("extensions.workspaceReview.binaryShort")}
            </span>
          ) : file.additions !== undefined && file.deletions !== undefined ? (
            <span
              className="flex shrink-0 gap-1 tabular-nums"
              aria-label={t("extensions.workspaceReview.lineChanges", {
                additions: file.additions,
                deletions: file.deletions,
              })}
            >
              <span className="text-success-foreground" aria-hidden>
                +{number(file.additions)}
              </span>
              <span className="text-danger-foreground" aria-hidden>
                −{number(file.deletions)}
              </span>
            </span>
          ) : null}
          <span className="flex shrink-0 text-muted-foreground">
            {isOpen ? (
              <ChevronUpIcon aria-hidden className="size-(--icon-size-sm)" />
            ) : (
              <ChevronDownIcon aria-hidden className="size-(--icon-size-sm)" />
            )}
          </span>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-center gap-1 pe-2 text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copyPathLabel}
            title={copyPathLabel}
            onClick={() => void copy(file.path)}
          >
            {copyStatus === "copied" ? <CheckIcon /> : <CopyIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("extensions.workspaceReview.fileActions.openInFileTab")}
            title={t("extensions.workspaceReview.fileActions.openInFileTab")}
            disabled={!context.rootPath || !(context.worktreeId ?? context.projectId)}
            onClick={openFileTab}
          >
            <FileCode2Icon />
          </Button>
        </div>
      </div>
      <CollapsibleContent>
        {isOpen && (
          <FilePatch
            key={`${options.fullFile}:${options.richText}`}
            request={request}
            file={file}
            options={options}
            cacheKey={cacheKey}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});

function ReviewComparison({ surface, reviewRevision }: ReviewProps & { reviewRevision: number }) {
  const { t } = useI18n(reviewTranslationBundle);
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const isCommit =
    surface.params.reviewScope === "commit" || surface.params.reviewScope === "range";
  const options = useMemo(
    () => ({ ...defaultReviewDisplayOptions, ...surface.params.displayOptions }),
    [surface.params.displayOptions],
  );
  const diffCacheKey = `${surface.resourceKey}:${reviewRevision}`;
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
  const query = useGitDiff(request, supported, diffCacheKey);
  const repository = query.data?.repository ? query.data : undefined;
  const reveal = (params: ReviewSurfaceParams) => {
    const id = controller.reveal({
      kind: "review",
      title: defineMessage("extensions.workspaceReview.title"),
      params,
      context,
    });
    if (id !== surface.id) controller.close(surface.id, context);
  };
  return (
    <section data-workspace-review="" className="flex h-full min-h-0 flex-col text-foreground">
      {request.scope === "branch" && (
        <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1 text-sm text-muted-foreground">
          <span className="min-w-0 truncate" title={repository?.branch}>
            {repository?.branch}
          </span>
          <ArrowRightIcon aria-hidden className="size-(--icon-size-sm) shrink-0" />
          <SearchableSelector
            items={repository?.branches ?? []}
            value={request.revision ?? null}
            onValueChange={(revision) => {
              if (revision) reveal({ ...surface.params, revision });
            }}
          >
            <SearchableSelectorTrigger
              className="min-w-0 shrink border-0 [background:transparent] px-1 font-normal text-muted-foreground"
              aria-label={t("extensions.workspaceReview.compareBranch")}
              title={request.revision}
            >
              <span className="truncate">{request.revision}</span>
            </SearchableSelectorTrigger>
            <SearchableSelectorContent
              data-workspace-review=""
              reserveScrollbarSpace={(repository?.branches.length ?? 0) > 8}
            >
              <SearchableSelectorSearch
                aria-label={t("extensions.workspaceReview.branchSearch")}
                placeholder={t("extensions.workspaceReview.branchSearch")}
                autoComplete="off"
                spellCheck={false}
              />
              <SearchableSelectorEmpty>
                {t("extensions.workspaceReview.noMatchingBranches")}
              </SearchableSelectorEmpty>
              <SearchableSelectorList>
                <SearchableSelectorGroup items={repository?.branches ?? []}>
                  <SearchableSelectorGroupLabel>
                    {t("extensions.workspaceReview.branches")}
                  </SearchableSelectorGroupLabel>
                  <SearchableSelectorCollection>
                    {(branch: string) => (
                      <SearchableSelectorItem key={branch} value={branch} title={branch}>
                        <GitBranchIcon
                          aria-hidden
                          className="size-(--icon-size-md) text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate">{branch}</span>
                      </SearchableSelectorItem>
                    )}
                  </SearchableSelectorCollection>
                </SearchableSelectorGroup>
              </SearchableSelectorList>
            </SearchableSelectorContent>
          </SearchableSelector>
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
                context={context}
                filesExpanded={surface.params.filesExpanded === true}
                cacheKey={diffCacheKey}
              />
            ))}
            {!query.loading && !query.error && repository?.files.length === 0 && (
              <div
                role="status"
                className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center text-base text-muted-foreground"
              >
                <FileDiffIcon aria-hidden className="size-(--icon-size-xxl) shrink-0" />
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
  return (
    <ReviewComparison
      key={`${props.surface.resourceKey}:${revision}:${props.retryToken ?? 0}`}
      reviewRevision={revision}
      {...props}
    />
  );
}
