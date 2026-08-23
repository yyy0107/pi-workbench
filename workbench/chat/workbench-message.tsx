"use client";

import { useEffect, useState } from "react";
import { ComposerPrimitive, MessagePrimitive, useAui, useAuiState } from "@assistant-ui/react";

import { ComposerAttachments, UserMessageAttachments } from "@/components/assistant-ui/attachment";
import {
  CompactionSeparator,
  ForkSeparator,
  ModelChangeSeparator,
} from "@/components/elements/conversation-separator";
import { DisclosureScrollDirectionProvider } from "@/components/elements/disclosure-scroll-direction";
import { ErrorState } from "@/components/elements/error-state";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SlotHost } from "@/platform/extensions";
import { parsePiConversationEvent } from "@/runtime/pi/client/messages/conversation-events";
import { readPiUsage } from "@/runtime/pi/client/messages/pi-usage";
import { parseWorkbenchComposerCommandResponseDetails } from "@/runtime/composer-request";
import { parsePiMessageTermination } from "@/runtime/pi/message-termination";

import { WorkbenchComposerCommandResponse } from "./composer-command-response";
import { WorkbenchMessageActions } from "./message-actions";
import { WorkbenchMessageParts } from "./message-parts";
import { isMessageInLatestTurn, shouldShowMessageError } from "./workbench-message-error";

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

function WorkbenchMessageError() {
  const { t } = useI18n();
  const aui = useAui();
  const status = useAuiState((state) => state.message.status);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isInLatestTurn = useAuiState((state) =>
    isMessageInLatestTurn(state.thread.messages, state.message.index),
  );
  const termination = parsePiMessageTermination(
    useAuiState((state) => state.message.metadata.custom.piTermination),
  );
  const outputTokens = readPiUsage(
    useAuiState((state) => state.message.metadata.custom.piUsage),
  )?.output;
  const [retryPhase, setRetryPhase] = useState<"idle" | "requested" | "running">("idle");

  useEffect(() => {
    if (retryPhase === "requested" && isRunning) setRetryPhase("running");
    if (retryPhase === "running" && !isRunning) setRetryPhase("idle");
  }, [isRunning, retryPhase]);

  if (
    status?.type !== "incomplete" ||
    !shouldShowMessageError({
      isRunning,
      isInLatestTurn,
      terminationKind: termination?.kind,
    })
  ) {
    return null;
  }

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
    if (isRunning) return;
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
      retryDisabled={isRunning}
      retryLabel={t("workbench.chat.errors.retry")}
      retryingLabel={t("workbench.chat.errors.retrying")}
      onRetry={retry}
    />
  );
}

export function WorkbenchUserMessage() {
  const isOptimistic = useAuiState((state) => state.message.metadata.isOptimistic === true);
  const [animateOnMount] = useState(isOptimistic);

  return (
    <MessagePrimitive.Root
      data-role="user"
      className="group/message flex w-full min-w-0 flex-col items-end gap-1.5"
    >
      <MessageSlot name="message.before" />
      <div
        className={cn(
          "flex max-w-full min-w-0 flex-col items-end gap-2",
          animateOnMount &&
            "fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-200 ease-out motion-reduce:animate-none",
        )}
      >
        <UserMessageAttachments />
        <div
          data-slot="user-message-bubble"
          data-workbench-glass-surface=""
          className="w-fit max-w-full min-w-0 self-end rounded-[12px] bg-muted/50 px-4 py-2.5 text-base leading-6 text-foreground whitespace-pre-wrap [overflow-wrap:anywhere] text-start"
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
  const preferUpward = useAuiState((state) => state.thread.isRunning && state.message.isLast);

  return (
    <MessagePrimitive.Root data-role="assistant" className="w-full min-w-0">
      <DisclosureScrollDirectionProvider preferUpward={preferUpward}>
        <MessageSlot name="message.before" />
        <div className="min-w-0 break-words leading-relaxed [overflow-anchor:none]">
          <WorkbenchMessageParts />
          <WorkbenchMessageError />
          <WorkbenchMessageActions className="mt-1" />
        </div>
        <MessageSlot name="message.after" />
      </DisclosureScrollDirectionProvider>
    </MessagePrimitive.Root>
  );
}

export function WorkbenchSystemMessage() {
  const { t } = useI18n();
  const conversationEventData = useAuiState(
    (state) => state.message.metadata.custom.piConversationEvent,
  );
  const conversationEvent = parsePiConversationEvent(conversationEventData);
  const commandResponse = parseWorkbenchComposerCommandResponseDetails(
    useAuiState((state) => state.message.metadata.custom.workbenchComposerCommandResponse),
  );

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
        ) : conversationEvent.kind === "fork" ? (
          <ForkSeparator
            label={t("workbench.chat.separators.continuedFromChat")}
            aria-label={t("workbench.chat.separators.continuedFromChat")}
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

  if (commandResponse) {
    return (
      <MessagePrimitive.Root className="mx-auto w-full max-w-[var(--thread-max-width)] px-2 py-2">
        <MessageSlot name="message.before" />
        <WorkbenchComposerCommandResponse response={commandResponse} />
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
