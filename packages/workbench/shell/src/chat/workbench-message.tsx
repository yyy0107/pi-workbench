"use client";

import { useEffect, useState } from "react";
import {
  CompactionSeparator,
  ForkSeparator,
  ModelChangeSeparator,
} from "../elements/conversation-separator";
import { DisclosureScrollDirectionProvider } from "../elements/disclosure-scroll-direction";
import { ErrorState } from "../elements/error-state";
import { useI18n } from "../i18n";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";
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
import { useSteeredTurn } from "./steered-turn";
import { WorkbenchMessageParts } from "./message-parts";
import {
  useConversationMessageContext,
  useConversationStructure,
} from "./conversation-message-context";
import { isLastAssistantInTurn } from "./message-action-visibility";
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

function WorkbenchMessageError() {
  const { t } = useI18n();
  const session = useConversationSession();
  const { messageId, index } = useConversationMessageContext();
  const node = useConversationNode(messageId);
  const status = node?.kind === "assistant" ? node.status : undefined;
  const custom = node?.presentation?.custom;
  const headlessError = useConversationNode(messageId, (node) => {
    if (node?.kind === "error") return node.error;
    if (!node || !("blocks" in node)) return undefined;
    return node.blocks.find((block) => block.kind === "error")?.error;
  });
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const resumeCheckpoint = useSessionState((snapshot) => snapshot.resumeCheckpoint);
  const messages = useConversationStructure();
  const isInLatestTurn = isMessageInLatestTurn(messages, index);
  const isLastAssistant = isLastAssistantInTurn(messages, index);
  const termination = parseWorkbenchMessageTermination(custom?.workbenchTermination);
  const kind =
    termination?.kind ??
    headlessError?.code ??
    (status === "error" ? "error" : status === "incomplete" ? "other" : undefined);
  const promptFailure = parseWorkbenchPromptFailureDetails(custom?.workbenchPromptFailure);
  const outputTokens = readWorkbenchMessageUsage(custom?.workbenchUsage)?.output;
  const [retryPhase, setRetryPhase] = useState<"idle" | "requested" | "running">("idle");
  const [continuationFailed, setContinuationFailed] = useState(false);

  useEffect(() => {
    if (retryPhase === "requested" && isRunning) setRetryPhase("running");
    if (retryPhase === "running" && !isRunning) setRetryPhase("idle");
  }, [isRunning, retryPhase]);

  if (
    (!headlessError && status !== "incomplete" && status !== "error" && !termination) ||
    !shouldShowMessageError({
      isRunning,
      isInLatestTurn,
      isLastAssistantInTurn: isLastAssistant,
      terminationKind: kind,
    })
  ) {
    return null;
  }

  const rawDetail = termination?.errorMessage ?? headlessError?.message;
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

  const messageResumeCheckpoint =
    resumeCheckpoint?.terminalMessageId === messageId ? resumeCheckpoint : undefined;
  const canContinueCheckpoint =
    messageResumeCheckpoint?.capability === "ready" && session.actions.resume !== undefined;
  const canRepairAndContinue =
    resumeCheckpoint === undefined &&
    isInLatestTurn &&
    isLastAssistant &&
    (kind === "cancelled" || kind === "aborted") &&
    session.actions.resumeLatest !== undefined;
  const canContinue = canContinueCheckpoint || canRepairAndContinue;
  if (messageResumeCheckpoint?.capability === "confirmation-required") {
    detail = t("workbench.chat.errors.resumeRequiresConfirmation");
  } else if (messageResumeCheckpoint?.capability === "blocked") {
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
    (kind === "cancelled" || kind === "aborted") && messageResumeCheckpoint === undefined;
  const showRetry =
    !messageResumeCheckpoint && !stoppedWithoutCheckpoint && session.actions.retry !== undefined;
  const showAction = isInLatestTurn && isLastAssistant && (canContinue || showRetry);

  const retry = () => {
    if (!showAction || isRunning || retryPhase !== "idle") return;
    setContinuationFailed(false);
    setRetryPhase("requested");
    try {
      const action = canContinue
        ? canContinueCheckpoint
          ? session.actions.resume?.(
              messageResumeCheckpoint.checkpointId,
              messageResumeCheckpoint.expectedStateId,
            )
          : session.actions.resumeLatest?.(messageId)
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
  const steeredTurn = useSteeredTurn();
  const { messageId } = useConversationMessageContext();
  const isOptimistic = useConversationNode(
    messageId,
    (node) => node?.presentation?.isOptimistic === true,
  );
  const [animateOnMount] = useState(isOptimistic);

  return (
    <div
      data-role="user"
      className="group/message relative flex w-full min-w-0 flex-col items-end gap-1.5"
    >
      <MessageSlot name="message.before" />
      <div
        data-slot="user-message-content"
        data-animate-enter={animateOnMount || undefined}
        className="flex max-w-full min-w-0 flex-col items-end gap-2"
      >
        <WorkbenchMessageParts />
      </div>
      <WorkbenchMessageActions
        className={steeredTurn ? "absolute right-0 top-full z-10 justify-end" : "justify-end"}
      />
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
  const { messageId } = useConversationMessageContext();
  const custom = useConversationNode(messageId, (node) => node?.presentation?.custom);
  const conversationEvent = parseWorkbenchConversationEvent(custom?.workbenchConversationEvent);
  const commandResponse = parseWorkbenchComposerCommandResponseDetails(
    custom?.workbenchComposerCommandResponse,
  );
  const compactionReason =
    conversationEvent?.kind === "compaction"
      ? t("workbench.chat.separators.contextCompactionReason", {
          reason: conversationEvent.reason,
        })
      : undefined;
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
            detail={
              <>
                {compactionDetail ? <span>{compactionDetail}</span> : null}
                <span>{compactionReason}</span>
              </>
            }
            aria-label={[
              t("workbench.chat.separators.contextCompactedAnnouncement", {
                before: conversationEvent.tokensBefore,
                after: conversationEvent.estimatedTokensAfter,
              }),
              compactionReason,
            ]
              .filter(Boolean)
              .join(" ")}
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
