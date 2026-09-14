"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, Loader2Icon, RotateCcwIcon, RotateCwIcon } from "lucide-react";

import { useSessionState } from "@workbench/agent-runtime-client";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";
import type { MessageRendererNode } from "@workbench/extension-sdk";
import { useI18n } from "@workbench/i18n";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  PathEllipsis,
  collapsePanel,
  useToastManager,
} from "@workbench/ui";
import { cn } from "@workbench/ui/utils";
import { useDisclosureScrollLock } from "@workbench/ui-disclosure";
import { FileTypeIcon } from "@workbench/ui-file-presentation/icons";
import { useMessageDisclosure } from "@workbench/ui-tool/message-disclosure-context";
import {
  useOpenerService,
  useRightWorkspace,
  useWorkspaceContext,
} from "@workbench/ui-workspace/react";
import { openFileLink, readWorkspaceFileDiffResource } from "@workbench/workspace-files";

import {
  messageFileChangeDisplayPath,
  messageFileChanges,
  type MessageFileChange,
} from "../lib/message-file-changes";
import { defineConversationMessage, conversationTranslationBundle } from "./i18n";

type FileChangeMutationState = "ready" | "undoing" | "undone" | "redoing";

function MessageFileChangeRow({
  change,
  onOpen,
  onReview,
  onDiff,
  loading,
}: Readonly<{
  change: MessageFileChange;
  onOpen(): void;
  onReview?: () => void;
  onDiff?: () => void;
  loading: boolean;
}>) {
  const { number, t } = useI18n(conversationTranslationBundle);
  const displayPath = messageFileChangeDisplayPath(change.path);
  return (
    <div className="flex min-w-0 items-center gap-2 border-t border-border px-1 py-1">
      <Button
        type="button"
        variant="ghost"
        className="min-w-0 flex-1 shrink justify-start gap-2 font-normal"
        aria-label={t("extensions.messagePresentation.fileChanges.openDiff", {
          name: change.filename,
        })}
        aria-busy={loading}
        disabled={!onDiff || loading}
        onClick={onDiff}
      >
        {loading ? (
          <Loader2Icon
            aria-hidden
            className="size-(--icon-size-md) shrink-0 animate-spin motion-reduce:animate-none"
          />
        ) : (
          <FileTypeIcon path={change.path} className="size-(--icon-size-md) shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-sm">
          <span title={change.filename} className="min-w-0 truncate font-normal text-foreground">
            {change.filename}
          </span>
          <PathEllipsis
            text={displayPath}
            prefixChars={24}
            suffixChars={32}
            className="min-w-0 shrink text-left text-muted-foreground/60"
          />
          <span className="ms-auto flex shrink-0 gap-1 text-sm tabular-nums">
            <span className="text-success-foreground">+{number(change.additions)}</span>
            <span className="text-danger-foreground">-{number(change.deletions)}</span>
          </span>
        </span>
      </Button>
      <div className="flex shrink-0 items-center gap-1.5 pe-2">
        {onReview ? (
          <Button type="button" variant="outline" size="xs" className="text-sm" onClick={onReview}>
            {t("extensions.messagePresentation.fileChanges.review")}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="xs" className="text-sm" onClick={onOpen}>
          {t("extensions.messagePresentation.fileChanges.open")}
        </Button>
      </div>
    </div>
  );
}

export function MessageFileChangesCard({ node }: Readonly<{ node: MessageRendererNode }>) {
  const { number, t } = useI18n(conversationTranslationBundle);
  const summary = useMemo(() => messageFileChanges(node), [node]);
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const [open, setOpen] = useMessageDisclosure("file-changes", node.key);
  const [collapsibleRef, onOpenChange] = useDisclosureScrollLock(setOpen);
  const [mutationState, setMutationState] = useState<FileChangeMutationState>("ready");
  const workspaceCapability = useWorkbenchWorkspaceCapability();
  const opener = useOpenerService();
  const workspace = useRightWorkspace();
  const context = useWorkspaceContext();
  const notifications = useToastManager();
  const diffRequest = useRef<AbortController | undefined>(undefined);
  const [loadingDiffPath, setLoadingDiffPath] = useState<string>();
  useEffect(() => {
    setLoadingDiffPath(undefined);
    return () => diffRequest.current?.abort();
  }, [context.rootPath, context.projectId, context.worktreeId, summary?.id, summary?.threadId]);

  if (!summary || node.kind !== "assistant" || node.status === "running") return null;

  const cancelDiff = () => {
    diffRequest.current?.abort();
    setLoadingDiffPath(undefined);
  };
  const repositoryId = context.worktreeId ?? context.projectId;
  const review = repositoryId
    ? () => {
        cancelDiff();
        workspace.reveal({
          kind: "review",
          title: defineConversationMessage(
            "extensions.messagePresentation.fileChanges.reviewTitle",
          ),
          params: {
            repositoryId,
            reviewScope: "last-turn",
            revision: summary.id,
            sessionId: summary.threadId,
          },
          context,
        });
      }
    : undefined;
  const openDiff = async (change: MessageFileChange) => {
    if (!workspaceCapability?.readGitDiff || !repositoryId) return;
    diffRequest.current?.abort();
    const controller = new AbortController();
    diffRequest.current = controller;
    setLoadingDiffPath(change.path);
    try {
      const resource = await readWorkspaceFileDiffResource(
        workspaceCapability,
        {
          workspaceId: repositoryId,
          scope: "last-turn",
          revision: summary.id,
          sessionId: summary.threadId,
          path: change.path,
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      await opener.open({ resource, context, policy: "force-focus" });
    } catch {
      if (!controller.signal.aborted)
        notifications.add({
          type: "error",
          title: t("extensions.messagePresentation.fileChanges.openDiffFailed", {
            name: change.filename,
          }),
        });
    } finally {
      if (diffRequest.current === controller && !controller.signal.aborted)
        setLoadingDiffPath(undefined);
    }
  };
  const mutate = (direction: "undo" | "redo") => {
    if (!workspaceCapability?.fileChanges || !repositoryId || isRunning) return;
    if (direction === "undo" ? mutationState !== "ready" : mutationState !== "undone") return;
    cancelDiff();
    setMutationState(direction === "undo" ? "undoing" : "redoing");
    const request = {
      workspaceId: repositoryId,
      threadId: summary.threadId,
      changeSetId: summary.id,
    };
    void workspaceCapability.fileChanges[direction](request).then(
      () => {
        setMutationState(direction === "undo" ? "undone" : "ready");
        notifications.add({
          type: "success",
          title: t(
            direction === "undo"
              ? "extensions.messagePresentation.fileChanges.undoSucceeded"
              : "extensions.messagePresentation.fileChanges.redoSucceeded",
            {
              count: summary.totalFiles,
            },
          ),
        });
      },
      (error: unknown) => {
        console.warn(`[message-file-changes] ${direction} failed`, error);
        setMutationState(direction === "undo" ? "ready" : "undone");
        notifications.add({
          type: "error",
          priority: "high",
          title: t(
            direction === "undo"
              ? "extensions.messagePresentation.fileChanges.undoFailed"
              : "extensions.messagePresentation.fileChanges.redoFailed",
          ),
        });
      },
    );
  };

  const mutationPending = mutationState === "undoing" || mutationState === "redoing";
  const redo = mutationState === "undone" || mutationState === "redoing";

  return (
    <Collapsible
      ref={collapsibleRef}
      open={open}
      onOpenChange={onOpenChange}
      data-slot="message-file-changes"
      className="group/file-changes mt-3 w-full overflow-hidden rounded-[var(--button-radius)] border border-border bg-card text-foreground [overflow-anchor:none]"
    >
      <div className="flex min-w-0 items-center transition-colors hover:bg-muted/50 focus-within:bg-muted/50">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRightIcon
            aria-hidden
            className="size-(--icon-size-sm) shrink-0 text-muted-foreground transition-transform group-data-open/file-changes:rotate-90 motion-reduce:transition-none"
          />
          <span className="font-medium">
            {t("extensions.messagePresentation.fileChanges.summary", {
              count: summary.totalFiles,
            })}
          </span>
          <span className="flex shrink-0 gap-1 font-mono text-sm tabular-nums">
            <span className="text-success-foreground">+{number(summary.additions)}</span>
            <span className="text-danger-foreground">-{number(summary.deletions)}</span>
          </span>
        </CollapsibleTrigger>
        {summary.undoAvailable && workspaceCapability?.fileChanges && repositoryId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="me-1.5 font-normal"
            disabled={mutationPending || isRunning}
            aria-label={t(
              redo
                ? "extensions.messagePresentation.fileChanges.redoLabel"
                : "extensions.messagePresentation.fileChanges.undoLabel",
              {
                count: summary.totalFiles,
              },
            )}
            onClick={() => mutate(redo ? "redo" : "undo")}
          >
            {mutationPending ? (
              <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : redo ? (
              <RotateCwIcon aria-hidden />
            ) : (
              <RotateCcwIcon aria-hidden />
            )}
            {t(
              mutationState === "undoing"
                ? "extensions.messagePresentation.fileChanges.undoing"
                : mutationState === "redoing"
                  ? "extensions.messagePresentation.fileChanges.redoing"
                  : redo
                    ? "extensions.messagePresentation.fileChanges.redo"
                    : "extensions.messagePresentation.fileChanges.undo",
            )}
          </Button>
        ) : null}
      </div>
      <CollapsibleContent
        className={cn(
          collapsePanel,
          "outline-none transition-[height,opacity] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        )}
      >
        {summary.files.map((change) => (
          <MessageFileChangeRow
            key={`${change.previousPath ?? ""}\u0000${change.path}`}
            change={change}
            onReview={review}
            onDiff={
              repositoryId && context.rootPath && workspaceCapability?.readGitDiff
                ? () => void openDiff(change)
                : undefined
            }
            loading={loadingDiffPath === change.path}
            onOpen={() => {
              cancelDiff();
              void openFileLink(opener, context, change.path).catch((error: unknown) => {
                console.warn("[message-file-changes] open failed", error);
                notifications.add({
                  type: "error",
                  title: t("extensions.messagePresentation.fileChanges.openFailed", {
                    name: change.filename,
                  }),
                });
              });
            }}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
