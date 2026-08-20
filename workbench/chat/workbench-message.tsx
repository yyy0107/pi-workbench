"use client";

import { useEffect, useState } from "react";
import { ComposerPrimitive, MessagePrimitive, useAui, useAuiState } from "@assistant-ui/react";

import { ComposerAttachments, UserMessageAttachments } from "@/components/assistant-ui/attachment";
import {
  CompactionSeparator,
  ModelChangeSeparator,
} from "@/components/elements/conversation-separator";
import { ErrorState } from "@/components/elements/error-state";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";
import { parsePiConversationEvent } from "@/runtime/pi/client/messages/conversation-events";
import { parsePiMessageTermination } from "@/runtime/pi/message-termination";

import { WorkbenchMessageActions } from "./message-actions";
import { WorkbenchMessageParts } from "./message-parts";

function MessageSlot({ name }: { name: "message.before" | "message.after" }) {
  const messageId = useAuiState((state) => state.message.id);
  const role = useAuiState((state) => state.message.role);
  const isLast = useAuiState((state) => state.message.isLast);

  return (
    <SlotHost
      name={name}
      context={{ messageId, role, isLast }}
      className="col-span-full [overflow-anchor:none]"
    />
  );
}

function readableErrorDetail(value: unknown): string | undefined {
  if (typeof value === "string") {
    const detail = value.trim();
    return detail && detail !== "pi_response_error" ? detail : undefined;
  }
  if (value === undefined || value === null) return undefined;

  try {
    const detail = JSON.stringify(value, null, 2);
    return detail && detail !== "{}" ? detail : undefined;
  } catch {
    return undefined;
  }
}

function outputTokenCount(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output = (value as { output?: unknown }).output;
  return typeof output === "number" && Number.isFinite(output) && output >= 0 ? output : undefined;
}

function WorkbenchMessageError() {
  const { t } = useI18n();
  const aui = useAui();
  const status = useAuiState((state) => state.message.status);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const termination = parsePiMessageTermination(
    useAuiState((state) => state.message.metadata.custom.piTermination),
  );
  const outputTokens = outputTokenCount(
    useAuiState((state) => state.message.metadata.custom.piUsage),
  );
  const [retryPhase, setRetryPhase] = useState<"idle" | "requested" | "running">("idle");

  useEffect(() => {
    if (retryPhase === "requested" && isRunning) setRetryPhase("running");
    if (retryPhase === "running" && !isRunning) setRetryPhase("idle");
  }, [isRunning, retryPhase]);

  if (status?.type !== "incomplete" || termination?.kind === "completed") return null;

  const rawDetail = termination?.errorMessage ?? readableErrorDetail(status.error);
  const kind = termination?.kind ?? status.reason;
  let title = t("workbench.chat.errors.requestFailedTitle");
  let detail = rawDetail ?? t("workbench.chat.errors.unknownFailure");

  switch (kind) {
    case "cancelled":
      title = t("workbench.chat.errors.generationStopped");
      detail = rawDetail ?? t("workbench.chat.errors.stoppedByUser");
      break;
    case "aborted":
      title = t("workbench.chat.errors.generationInterrupted");
      detail = rawDetail ?? t("workbench.chat.errors.interrupted");
      break;
    case "length":
      title = t("workbench.chat.errors.generationStopped");
      detail = t(
        "workbench.chat.errors.outputLimit",
        outputTokens === undefined ? {} : { tokens: outputTokens },
      );
      break;
    case "network-error":
      title = t("workbench.chat.errors.connectionFailed");
      detail = rawDetail ?? t("workbench.chat.errors.networkFailure");
      break;
    case "api-error":
      detail = rawDetail ?? t("workbench.chat.errors.apiFailure");
      break;
    case "provider-error":
      detail = rawDetail ?? t("workbench.chat.errors.providerFailure");
      break;
  }

  const retry = () => {
    setRetryPhase("requested");
    try {
      void Promise.resolve(aui.message.reload()).then(
        () => setRetryPhase((current) => (current === "requested" ? "running" : current)),
        () => setRetryPhase("idle"),
      );
    } catch {
      setRetryPhase("idle");
    }
  };

  return (
    <ErrorState
      className="mt-3 max-w-full"
      title={title}
      detail={detail}
      retrying={retryPhase !== "idle"}
      retryLabel={t("workbench.chat.errors.retry")}
      retryingLabel={t("workbench.chat.errors.retrying")}
      onRetry={retry}
    />
  );
}

export function WorkbenchUserMessage() {
  return (
    <MessagePrimitive.Root
      data-role="user"
      className="group/message flex w-full min-w-0 flex-col items-end gap-1.5"
    >
      <MessageSlot name="message.before" />
      <div className="flex max-w-full min-w-0 flex-col items-end gap-2">
        <UserMessageAttachments />
        <div
          data-slot="user-message-bubble"
          data-workbench-glass-surface=""
          className="min-w-0 max-w-full rounded-[22px] bg-[rgb(237,243,254)] px-3.5 py-2 break-words text-start dark:bg-[rgb(44,44,46)]"
        >
          <WorkbenchMessageParts />
        </div>
      </div>
      <WorkbenchMessageActions className="justify-end" />
      <MessageSlot name="message.after" />
    </MessagePrimitive.Root>
  );
}

export function WorkbenchAssistantMessage() {
  return (
    <MessagePrimitive.Root data-role="assistant" className="w-full min-w-0">
      <MessageSlot name="message.before" />
      <div className="min-w-0 break-words leading-relaxed [overflow-anchor:none]">
        <WorkbenchMessageParts />
        <WorkbenchMessageError />
        <WorkbenchMessageActions className="mt-1" />
      </div>
      <MessageSlot name="message.after" />
      <span
        data-slot="assistant-scroll-anchor"
        aria-hidden="true"
        className="block size-px [overflow-anchor:auto]"
      />
    </MessagePrimitive.Root>
  );
}

export function WorkbenchSystemMessage() {
  const { t } = useI18n();
  const conversationEventData = useAuiState(
    (state) => state.message.metadata.custom.piConversationEvent,
  );
  const conversationEvent = parsePiConversationEvent(conversationEventData);

  if (conversationEvent) {
    const modelLabel =
      conversationEvent.kind === "model-change"
        ? [conversationEvent.provider, conversationEvent.model].filter(Boolean).join("/")
        : undefined;
    const previousModelLabel =
      conversationEvent.kind === "model-change" && conversationEvent.previousModel
        ? [conversationEvent.previousProvider, conversationEvent.previousModel]
            .filter(Boolean)
            .join("/")
        : undefined;
    const compactionDetail =
      conversationEvent.kind === "compaction" &&
      conversationEvent.tokensBefore !== undefined &&
      conversationEvent.estimatedTokensAfter !== undefined
        ? t("workbench.chat.separators.contextCompactedTokens", {
            before: conversationEvent.tokensBefore,
            after: conversationEvent.estimatedTokensAfter,
          })
        : conversationEvent.kind === "compaction" && conversationEvent.tokensBefore !== undefined
          ? t("workbench.chat.separators.contextCompactedBefore", {
              before: conversationEvent.tokensBefore,
            })
          : undefined;

    return (
      <MessagePrimitive.Root className="w-full py-0.5">
        <MessageSlot name="message.before" />
        {conversationEvent.kind === "model-change" ? (
          <ModelChangeSeparator
            label={t("workbench.chat.separators.modelChanged")}
            model={modelLabel ?? conversationEvent.model}
            previousModel={previousModelLabel}
            aria-label={t("workbench.chat.separators.modelChangedAnnouncement", {
              model: modelLabel ?? conversationEvent.model,
              previousModel: previousModelLabel,
            })}
          />
        ) : (
          <CompactionSeparator
            label={t("workbench.chat.separators.contextCompacted")}
            detail={compactionDetail}
            aria-label={t("workbench.chat.separators.contextCompactedAnnouncement", {
              before: conversationEvent.tokensBefore,
              after: conversationEvent.estimatedTokensAfter,
            })}
          />
        )}
        <MessageSlot name="message.after" />
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-[var(--thread-max-width)] px-2 py-2">
      <MessageSlot name="message.before" />
      <div
        data-workbench-glass-surface=""
        className="bg-muted/50 text-muted-foreground rounded-lg border px-3 py-2 text-xs"
      >
        <WorkbenchMessageParts />
      </div>
      <MessageSlot name="message.after" />
    </MessagePrimitive.Root>
  );
}

export function WorkbenchEditComposer() {
  const { t } = useI18n();

  return (
    <MessagePrimitive.Root className="w-full min-w-0">
      <ComposerPrimitive.Root className="flex w-full flex-col gap-2">
        <ComposerAttachments />
        <ComposerPrimitive.Input
          autoFocus
          className="min-h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
          aria-label={t("workbench.chat.edit.label")}
        />
        <div className="flex items-center justify-end gap-2">
          <ComposerPrimitive.Cancel render={<Button type="button" variant="ghost" size="sm" />}>
            {t("workbench.chat.edit.cancel")}
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button type="submit" size="sm" />}>
            {t("workbench.chat.edit.update")}
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
