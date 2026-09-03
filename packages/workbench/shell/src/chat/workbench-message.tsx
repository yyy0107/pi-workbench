"use client";

import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  CompactionSeparator,
  ForkSeparator,
  ModelChangeSeparator,
} from "../elements/conversation-separator";
import { DisclosureScrollDirectionProvider } from "../elements/disclosure-scroll-direction";
import { ErrorState } from "../elements/error-state";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
import { readAgentRunRecovery } from "@workbench/agent-runtime-client/extras";
import {
  useConversationNode,
  useConversationSession,
  useSessionState,
} from "@workbench/agent-runtime-client";
import {
  parseWorkbenchConversationEvent,
  parseWorkbenchMessageTermination,
  readWorkbenchMessageUsage,
} from "@workbench/agent-runtime-contracts/message-metadata";
import { parseWorkbenchComposerCommandResponseDetails } from "@workbench/contracts/composer/request";
import { parseWorkbenchPromptFailureDetails } from "@workbench/contracts/composer/request";

import { WorkbenchComposerCommandResponse } from "./composer-command-response";
import { WorkbenchMessageActions } from "./message-actions";
import { WorkbenchMessageParts } from "./message-parts";
import { useConversationMessageContext } from "./conversation-message-context";
import { isMessageInLatestTurn, shouldShowMessageError } from "./workbench-message-error";

function MessageSlot({ name }: { name: "message.before" | "message.after" }) {
  const { messageId, role, isLast } = useConversationMessageContext();

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
    return detail || undefined;
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
  const session = useConversationSession();
  const { messageId, index } = useConversationMessageContext();
  const status = useAuiState((state) => state.message.status);
  const headlessError = useConversationNode(messageId, (node) => {
    if (node?.kind === "error") return node.error;
    if (!node || !("blocks" in node)) return undefined;
    return node.blocks.find((block) => block.kind === "error")?.error;
  });
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const nodeKeys = useSessionState((snapshot) => snapshot.nodeKeys);
  const recovery = readAgentRunRecovery(useAuiState((state) => state.thread.extras));
  const isInLatestTurn = isMessageInLatestTurn(
    nodeKeys.map((key) => {
      const node = session.node(key).getSnapshot();
      return {
        role: node?.kind === "user" || node?.kind === "assistant" ? node.kind : "system",
      };
    }),
    index,
  );
  const termination = parseWorkbenchMessageTermination(
    useAuiState((state) => state.message.metadata.custom.workbenchTermination),
  );
  const promptFailure = parseWorkbenchPromptFailureDetails(
    useAuiState((state) => state.message.metadata.custom.workbenchPromptFailure),
  );
  const outputTokens = readWorkbenchMessageUsage(
    useAuiState((state) => state.message.metadata.custom.workbenchUsage),
  )?.output;
  const [retryPhase, setRetryPhase] = useState<"idle" | "requested" | "running">("idle");
  const [continuationFailed, setContinuationFailed] = useState(false);

  useEffect(() => {
    if (retryPhase === "requested" && isRunning) setRetryPhase("running");
    if (retryPhase === "running" && !isRunning) setRetryPhase("idle");
  }, [isRunning, retryPhase]);

  if (
    (!headlessError && status?.type !== "incomplete") ||
    !shouldShowMessageError({
      isRunning,
      isInLatestTurn,
      terminationKind: termination?.kind,
    })
  ) {
    return null;
  }

  const rawDetail =
    termination?.errorMessage ??
    headlessError?.message ??
    readableErrorDetail(status?.type === "incomplete" ? status.error : undefined);
  const kind =
    termination?.kind ??
    headlessError?.code ??
    (status?.type === "incomplete" ? status.reason : undefined);
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
  if (promptFailure?.code === "image-input-unsupported") {
    title = t("workbench.chat.errors.imageInputUnsupportedTitle");
    detail = t("workbench.chat.errors.imageInputUnsupported");
  }

  const resumeCheckpoint =
    recovery.resumeCheckpoint?.terminalMessageId === messageId
      ? recovery.resumeCheckpoint
      : undefined;
  const canContinueCheckpoint =
    resumeCheckpoint?.capability === "ready" && recovery.resume !== undefined;
  const canRepairAndContinue =
    resumeCheckpoint === undefined &&
    isInLatestTurn &&
    (kind === "cancelled" || kind === "aborted") &&
    recovery.resumeLatest !== undefined;
  const canContinue = canContinueCheckpoint || canRepairAndContinue;
  if (resumeCheckpoint?.capability === "confirmation-required") {
    detail = t("workbench.chat.errors.resumeRequiresConfirmation");
  } else if (resumeCheckpoint?.capability === "blocked") {
    detail = t("workbench.chat.errors.resumeRequiresModelChange");
  } else if (canContinue && continuationFailed) {
    detail = t("workbench.chat.errors.continueFailed");
  } else if (canContinue) {
    detail =
      kind === "cancelled"
        ? t("workbench.chat.errors.stoppedCanContinue")
        : (rawDetail ?? t("workbench.chat.errors.interruptedCanContinue"));
  }

  const stoppedWithoutCheckpoint =
    (kind === "cancelled" || kind === "aborted") && resumeCheckpoint === undefined;
  const showRetry =
    !resumeCheckpoint && !stoppedWithoutCheckpoint && session.actions.retry !== undefined;
  const showAction = canContinue || showRetry;

  const retry = () => {
    if (isRunning) return;
    setContinuationFailed(false);
    setRetryPhase("requested");
    try {
      const action = canContinue
        ? canContinueCheckpoint
          ? recovery.resume?.(resumeCheckpoint.checkpointId, resumeCheckpoint.expectedStateId)
          : recovery.resumeLatest?.(messageId)
        : session.actions.retry?.(messageId);
      void Promise.resolve(action).then(
        () => setRetryPhase((current) => (current === "requested" ? "running" : current)),
        (error) => {
          setRetryPhase("idle");
          if (canContinue) {
            console.warn("[workbench-agent] task continuation failed", error);
            setContinuationFailed(true);
          }
        },
      );
    } catch (error) {
      setRetryPhase("idle");
      if (canContinue) {
        console.warn("[workbench-agent] task continuation failed", error);
        setContinuationFailed(true);
      }
    }
  };

  return (
    <ErrorState
      className="mt-3 max-w-full"
      title={title}
      detail={detail}
      retrying={retryPhase !== "idle"}
      retryDisabled={isRunning}
      retryLabel={t(canContinue ? "workbench.chat.errors.continue" : "workbench.chat.errors.retry")}
      retryingLabel={t(
        canContinue ? "workbench.chat.errors.continuing" : "workbench.chat.errors.retrying",
      )}
      onRetry={retry}
      tone={kind === "cancelled" || kind === "aborted" ? "stopped" : "error"}
      actionKind={canContinue ? "continue" : "retry"}
      showAction={showAction}
    />
  );
}

export function WorkbenchUserMessage() {
  const { messageId } = useConversationMessageContext();
  const isOptimistic = useConversationNode(
    messageId,
    (node) => node?.presentation?.isOptimistic === true,
  );
  const [animateOnMount] = useState(isOptimistic);

  return (
    <div data-role="user" className="group/message flex w-full min-w-0 flex-col items-end gap-1.5">
      <MessageSlot name="message.before" />
      <div
        className={cn(
          "flex max-w-full min-w-0 flex-col items-end gap-2",
          animateOnMount &&
            "fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-200 ease-out motion-reduce:animate-none",
        )}
      >
        <WorkbenchMessageParts />
      </div>
      <WorkbenchMessageActions className="justify-end" />
      <MessageSlot name="message.after" />
    </div>
  );
}

export function WorkbenchAssistantMessage() {
  const { isLast } = useConversationMessageContext();
  const preferUpward = useSessionState((snapshot) => snapshot.isRunning) && isLast;

  return (
    <div data-role="assistant" className="w-full min-w-0">
      <DisclosureScrollDirectionProvider preferUpward={preferUpward}>
        <MessageSlot name="message.before" />
        <div className="min-w-0 break-words leading-relaxed [overflow-anchor:none]">
          <WorkbenchMessageParts />
          <WorkbenchMessageError />
          <WorkbenchMessageActions className="mt-1" />
        </div>
        <MessageSlot name="message.after" />
      </DisclosureScrollDirectionProvider>
    </div>
  );
}

export function WorkbenchSystemMessage() {
  const { t } = useI18n();
  const conversationEventData = useAuiState(
    (state) => state.message.metadata.custom.workbenchConversationEvent,
  );
  const conversationEvent = parseWorkbenchConversationEvent(conversationEventData);
  const commandResponse = parseWorkbenchComposerCommandResponseDetails(
    useAuiState((state) => state.message.metadata.custom.workbenchComposerCommandResponse),
  );
  const compactionDetail =
    conversationEvent?.kind === "compaction" &&
    conversationEvent.tokensBefore !== undefined &&
    conversationEvent.estimatedTokensAfter !== undefined
      ? t("workbench.chat.separators.contextCompactedTokens", {
          before: conversationEvent.tokensBefore,
          after: conversationEvent.estimatedTokensAfter,
        })
      : conversationEvent?.kind === "compaction" && conversationEvent.tokensBefore !== undefined
        ? t("workbench.chat.separators.contextCompactedBefore", {
            before: conversationEvent.tokensBefore,
          })
        : undefined;

  if (commandResponse?.commandId === "compact") {
    return (
      <div className="w-full py-0.5">
        <MessageSlot name="message.before" />
        <WorkbenchComposerCommandResponse
          response={commandResponse}
          compactionDetail={compactionDetail}
        />
        <MessageSlot name="message.after" />
      </div>
    );
  }

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
    return (
      <div className="w-full py-0.5">
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
      </div>
    );
  }

  if (commandResponse) {
    return (
      <div className="mx-auto w-full max-w-[var(--thread-content-max-width)] px-2 py-2">
        <MessageSlot name="message.before" />
        <WorkbenchComposerCommandResponse response={commandResponse} />
        <MessageSlot name="message.after" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[var(--thread-content-max-width)] px-2 py-2">
      <MessageSlot name="message.before" />
      <div
        data-workbench-glass-surface=""
        className="bg-muted/50 text-muted-foreground rounded-lg border px-3 py-2 text-xs"
      >
        <WorkbenchMessageParts />
      </div>
      <MessageSlot name="message.after" />
    </div>
  );
}
