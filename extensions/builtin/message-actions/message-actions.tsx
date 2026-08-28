"use client";

import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  useAui,
  useAuiState,
  useMessageTiming,
} from "@assistant-ui/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GaugeIcon,
  PencilIcon,
  RefreshCwIcon,
  SplitIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { formatAdaptiveDuration } from "@/lib/format-duration";
import { type MessageSlotContext, useExtensionErrorReporter } from "@/platform/extensions";
import {
  usePiActiveSessionId,
  usePiSessionManager,
  usePiThreadListItemSnapshot,
} from "@/runtime/pi/client/runtime/context";
import { readPiUsage } from "@/runtime/pi/client/messages/pi-usage";
import { readPiTurnStatistics } from "@/runtime/pi/client/messages/session-statistics";
import { parseAttachmentRecognitionSnapshot } from "@/runtime/shared/attachment-understanding/state-machine";

import { assistantForkEventSequence, isExpectedForkUnavailableError } from "./fork-availability";
import { messageCacheHitRate, messageTokensPerSecond } from "./message-performance-statistics";
import { shouldShowMessagePerformance } from "./message-performance-visibility";

function MessagePerformance() {
  const timing = useMessageTiming();
  const rawUsage = useAuiState((state) =>
    state.message.role === "assistant" ? state.message.metadata.custom.piUsage : undefined,
  );
  const rawTurnStatistics = useAuiState((state) =>
    state.message.role === "assistant" ? state.message.metadata.custom.piTurnStatistics : undefined,
  );
  const usage = useMemo(() => readPiUsage(rawUsage), [rawUsage]);
  const turnStatistics = useMemo(
    () => readPiTurnStatistics(rawTurnStatistics),
    [rawTurnStatistics],
  );
  const { locale, number, t } = useI18n();
  const stats: { label: string; value: string }[] = [];
  const formatTokens = (tokens: number) =>
    number(tokens, { notation: "compact", maximumFractionDigits: 1 });

  if (timing?.firstTokenTime !== undefined) {
    stats.push({
      label: t("extensions.messageActions.timing.firstToken"),
      value: formatAdaptiveDuration(timing.firstTokenTime, locale),
    });
  }
  if (usage) {
    stats.push(
      {
        label: t("extensions.messageActions.timing.inputTokens"),
        value: formatTokens(usage.input),
      },
      {
        label: t("extensions.messageActions.timing.outputTokens"),
        value: formatTokens(usage.output),
      },
    );
  }
  const tokensPerSecond = messageTokensPerSecond({
    turnStatistics,
    timingTokensPerSecond: timing?.tokensPerSecond,
  });
  if (tokensPerSecond !== undefined) {
    stats.push({
      label: t("extensions.messageActions.timing.tokensPerSecond"),
      value: number(tokensPerSecond, { maximumFractionDigits: 1 }),
    });
  }
  const cacheHitRate = messageCacheHitRate({ turnStatistics, usage });
  if (cacheHitRate !== undefined) {
    stats.push({
      label: t("extensions.messageActions.timing.cacheHitRate"),
      value: number(cacheHitRate, {
        style: "percent",
        maximumFractionDigits: 1,
      }),
    });
  }

  if (stats.length === 0) return null;

  const label = t("extensions.messageActions.timing.details");

  return (
    <ActionBarPrimitive.Root autohide="never" className="flex items-center">
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={100}
          closeDelay={100}
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              className="active:scale-90"
            />
          }
        >
          <GaugeIcon className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent side="right" align="center" sideOffset={6} className="w-52 p-3">
          <PopoverTitle className="sr-only">{label}</PopoverTitle>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
            {stats.map((stat) => (
              <div key={stat.label} className="contents">
                <dt className="text-muted-foreground text-xs">{stat.label}</dt>
                <dd className="text-foreground text-right font-mono text-xs font-medium tabular-nums">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </ActionBarPrimitive.Root>
  );
}

function BranchPicker() {
  const { t } = useI18n();

  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className="text-muted-foreground inline-flex items-center text-xs"
    >
      <BranchPickerPrimitive.Previous
        render={<TooltipIconButton tooltip={t("extensions.messageActions.previousResponse")} />}
      >
        <ChevronLeftIcon className="size-3.5" />
      </BranchPickerPrimitive.Previous>
      <span className="px-0.5 font-medium tabular-nums">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next
        render={<TooltipIconButton tooltip={t("extensions.messageActions.nextResponse")} />}
      >
        <ChevronRightIcon className="size-3.5" />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

function UserActions() {
  const { t } = useI18n();
  const isRunning = useAuiState((state) => state.thread.isRunning);

  return (
    <ActionBarPrimitive.Root autohide="never" className="flex items-center gap-0.5">
      <ActionBarPrimitive.Edit
        disabled={isRunning}
        render={<TooltipIconButton tooltip={t("extensions.messageActions.editMessage")} />}
      >
        <PencilIcon className="size-3.5" />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
}

function AssistantActions({ canReload }: Readonly<{ canReload: boolean }>) {
  const { t } = useI18n();
  const aui = useAui();
  const manager = usePiSessionManager();
  const sessionId = usePiActiveSessionId();
  const session = usePiThreadListItemSnapshot(sessionId);
  const reportError = useExtensionErrorReporter();
  const rawEventSeq = useAuiState((state) => state.message.metadata.custom.piEventSeq);
  const eventSeq = assistantForkEventSequence(rawEventSeq);
  const retriesCancelledAttachment = useAuiState((state) => {
    if (state.message.metadata.custom.workbenchAttachmentRecognitionOnly !== true) return false;
    return (
      parseAttachmentRecognitionSnapshot(
        state.message.metadata.custom.workbenchAttachmentRecognition,
      )?.status === "cancelled"
    );
  });
  const [forkState, setForkState] = useState<"idle" | "pending" | "failed">("idle");
  const forkConversation = useCallback(async () => {
    if (!sessionId || eventSeq === undefined || forkState === "pending") return;
    setForkState("pending");
    try {
      const forked = await manager.forkSessionAt({
        sessionId,
        atSeq: eventSeq,
        sourceTitle: session?.title ?? t("workbench.sidebar.newThread"),
      });
      await aui.threads.reload();
      window.history.pushState(null, "", `/c/${encodeURIComponent(forked.sessionId)}`);
    } catch (error) {
      setForkState("failed");
      if (!isExpectedForkUnavailableError(error)) {
        reportError(error, {
          source: "slot",
          contributionId: "message-actions.fork-conversation",
        });
      }
    }
  }, [aui, eventSeq, forkState, manager, reportError, session?.title, sessionId, t]);
  const forkTooltip =
    forkState === "pending"
      ? t("extensions.messageActions.forkConversationPending")
      : forkState === "failed"
        ? t("extensions.messageActions.forkConversationFailed")
        : t("extensions.messageActions.forkConversation");

  return (
    <ActionBarPrimitive.Root autohide="never" className="flex items-center gap-0.5">
      {sessionId && eventSeq !== undefined ? (
        <TooltipIconButton
          tooltip={forkTooltip}
          type="button"
          disabled={forkState === "pending"}
          onClick={forkConversation}
        >
          <SplitIcon className="size-3.5 rotate-90" />
        </TooltipIconButton>
      ) : null}
      {canReload ? (
        <ActionBarPrimitive.Reload
          render={
            <TooltipIconButton
              tooltip={t(
                retriesCancelledAttachment
                  ? "extensions.messageActions.retryAttachmentRequest"
                  : "extensions.messageActions.regenerateResponse",
              )}
            />
          }
        >
          <RefreshCwIcon className="size-3.5" />
        </ActionBarPrimitive.Reload>
      ) : null}
    </ActionBarPrimitive.Root>
  );
}

export function MessageActions({ role, isLast }: MessageSlotContext) {
  const capabilities = useAuiState((state) => state.thread.capabilities);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const showPerformance = shouldShowMessagePerformance({ isLast, isRunning });

  return (
    <>
      {role === "user" && capabilities.edit ? <UserActions /> : null}
      {role === "assistant" ? (
        <>
          <AssistantActions canReload={capabilities.reload} />
          {showPerformance ? <MessagePerformance /> : null}
        </>
      ) : null}
      {capabilities.switchToBranch ? <BranchPicker /> : null}
    </>
  );
}
