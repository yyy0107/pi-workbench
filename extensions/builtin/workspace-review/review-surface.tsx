"use client";

import { FileDiffIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { defineMessage, useI18n } from "@/i18n";
import { useExtensionErrorReporter, type WorkspaceSurfaceProps } from "@/platform/extensions";

import { InlineFeedbackForm, useRightWorkspace } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { gitReviewService as git, type GitDiff } from "./git-review-service";

export interface ReviewSurfaceParams extends Record<string, unknown> {
  repositoryId: string;
  reviewScope: "unstaged" | "staged" | "commit" | "branch" | "last-turn";
  revision?: string;
}

const REVIEW_LOAD_FAILED = defineMessage("extensions.workspaceReview.loadFailed");

export function ReviewSurface({
  surface,
  retryToken = 0,
}: WorkspaceSurfaceProps<ReviewSurfaceParams>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const reportError = useExtensionErrorReporter();
  const revision = useSyncExternalStore(
    git.subscribe.bind(git),
    git.getRevision.bind(git),
    () => 0,
  );
  const [diff, setDiff] = useState<GitDiff>();

  const refresh = () => {
    controller.update(surface.id, { status: "loading" });
    void git
      .getDiff({
        repositoryId: surface.params.repositoryId,
        scope: surface.params.reviewScope,
        ...(surface.params.revision ? { revision: surface.params.revision } : {}),
      })
      .then((value) => {
        setDiff(value);
        controller.update(surface.id, { status: "ready", statusMessage: undefined });
      })
      .catch((error: unknown) => {
        reportError(error, { source: "workspace", contributionId: surface.id });
        controller.update(surface.id, {
          status: "error",
          statusMessage: REVIEW_LOAD_FAILED,
        });
      });
  };

  useEffect(refresh, [retryToken, revision, surface.resourceKey]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <FileDiffIcon className="text-muted-foreground size-4" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {surface.params.repositoryId} · {surface.params.reviewScope}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("extensions.workspaceReview.refresh")}
          title={t("extensions.workspaceReview.refresh")}
          className="text-muted-foreground hover:text-foreground"
          onClick={refresh}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {diff?.files.length ? (
          <div className="space-y-2">
            {diff.files.map((file) => (
              <article key={file.path} className="overflow-visible rounded-xl border">
                <header className="bg-muted/35 flex h-9 items-center gap-2 border-b px-3 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                  <span className="text-emerald-600">+{file.additions}</span>
                  <span className="text-rose-600">−{file.deletions}</span>
                </header>
                <div className="relative font-mono text-[11px] leading-5">
                  {file.lines.map((line, index) => (
                    <div
                      key={`${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`}
                      className={`group/line relative flex min-h-7 items-center ${
                        line.kind === "addition"
                          ? "bg-emerald-500/8"
                          : line.kind === "deletion"
                            ? "bg-rose-500/8"
                            : ""
                      }`}
                    >
                      <span className="text-muted-foreground w-9 shrink-0 select-none text-right">
                        {line.oldLine ?? ""}
                      </span>
                      <span className="text-muted-foreground w-9 shrink-0 select-none pr-2 text-right">
                        {line.newLine ?? ""}
                      </span>
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-2">
                        {line.text}
                      </code>
                      <InlineFeedbackForm
                        surface={surface}
                        kind="diff-line"
                        label={t("extensions.workspaceReview.commentLine")}
                        target={{
                          path: file.path,
                          side: line.kind === "deletion" ? "old" : "new",
                          line: line.newLine ?? line.oldLine ?? index + 1,
                        }}
                      />
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-xs">
            <FileDiffIcon className="size-7 opacity-45" />
            <p className="text-foreground font-medium">{t("extensions.workspaceReview.empty")}</p>
            <p>{t("extensions.workspaceReview.connectHint")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
