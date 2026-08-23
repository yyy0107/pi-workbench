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
  PencilIcon,
  RefreshCwIcon,
  SplitIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { MessageTiming, type TimingStat } from "@/components/elements/message-timing";
import { useI18n } from "@/i18n";
import { type MessageSlotContext, useExtensionErrorReporter } from "@/platform/extensions";
import {
  usePiActiveSessionId,
  usePiSessionManager,
  usePiThreadListItemSnapshot,
} from "@/runtime/pi/client/runtime/context";

interface PiUsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function readPiUsage(value: unknown): PiUsageStats | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  if (
    typeof usage.input !== "number" ||
    typeof usage.output !== "number" ||
    typeof usage.cacheRead !== "number" ||
    typeof usage.cacheWrite !== "number"
  ) {
    return undefined;
  }
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
  };
}

function MessagePerformance() {
  const timing = useMessageTiming();
  const rawUsage = useAuiState((state) =>
    state.message.role === "assistant" ? state.message.metadata.custom.piUsage : undefined,
  );
  const usage = useMemo(() => readPiUsage(rawUsage), [rawUsage]);
  const { number, t } = useI18n();
  const stats: TimingStat[] = [];
  const formatDuration = (milliseconds: number) =>
    milliseconds < 1_000
      ? `${number(Math.round(milliseconds))}ms`
      : `${number(milliseconds / 1_000, { maximumFractionDigits: 2 })}s`;
  const formatTokens = (tokens: number) =>
    number(tokens, { notation: "compact", maximumFractionDigits: 1 });

  if (timing?.firstTokenTime !== undefined) {
    stats.push({
      label: t("extensions.messageActions.timing.firstToken"),
      value: formatDuration(timing.firstTokenTime),
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
  if (timing?.tokensPerSecond !== undefined) {
    stats.push({
      label: t("extensions.messageActions.timing.tokensPerSecond"),
      value: number(timing.tokensPerSecond, { maximumFractionDigits: 1 }),
    });
  }
  if (usage) {
    const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
    if (promptTokens > 0) {
      stats.push({
        label: t("extensions.messageActions.timing.cacheHitRate"),
        value: number(usage.cacheRead / promptTokens, {
          style: "percent",
          maximumFractionDigits: 1,
        }),
      });
    }
  }

  if (stats.length === 0) return null;

  return (
    <ActionBarPrimitive.Root hideWhenRunning autohide="always" className="flex items-center">
      <MessageTiming stats={stats} className="w-auto max-w-none" />
    </ActionBarPrimitive.Root>
  );
}

function BranchPicker() {
  const { t } = useI18n();

  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className="text-muted-foreground me-1 inline-flex items-center text-xs"
    >
      <BranchPickerPrimitive.Previous
        render={<TooltipIconButton tooltip={t("extensions.messageActions.previousResponse")} />}
      >
        <ChevronLeftIcon className="size-3.5" />
      </BranchPickerPrimitive.Previous>
      <span className="px-1 font-medium tabular-nums">
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

  return (
    <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="flex items-center gap-0.5">
      <ActionBarPrimitive.Edit
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
  const eventSeq =
    typeof rawEventSeq === "number" && Number.isSafeInteger(rawEventSeq) && rawEventSeq >= 0
      ? rawEventSeq
      : undefined;
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
      reportError(error, {
        source: "slot",
        contributionId: "message-actions.fork-conversation",
      });
    }
  }, [aui, eventSeq, forkState, manager, reportError, session?.title, sessionId, t]);
  const forkTooltip =
    forkState === "pending"
      ? t("extensions.messageActions.forkConversationPending")
      : forkState === "failed"
        ? t("extensions.messageActions.forkConversationFailed")
        : t("extensions.messageActions.forkConversation");

  return (
    <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="flex items-center gap-0.5">
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
          render={<TooltipIconButton tooltip={t("extensions.messageActions.regenerateResponse")} />}
        >
          <RefreshCwIcon className="size-3.5" />
        </ActionBarPrimitive.Reload>
      ) : null}
    </ActionBarPrimitive.Root>
  );
}

export function MessageActions({ role }: MessageSlotContext) {
  const capabilities = useAuiState((state) => state.thread.capabilities);

  return (
    <>
      {capabilities.switchToBranch ? <BranchPicker /> : null}
      {role === "user" && capabilities.edit ? <UserActions /> : null}
      {role === "assistant" ? (
        <>
          <AssistantActions canReload={capabilities.reload} />
          <MessagePerformance />
        </>
      ) : null}
    </>
  );
}
