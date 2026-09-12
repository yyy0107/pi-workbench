"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GaugeIcon,
  RefreshCwIcon,
  SplitIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  useConversationNode,
  useConversationSession,
  useSessionState,
} from "@workbench/agent-runtime-client";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";
import {
  readWorkbenchMessageStateToken,
  readWorkbenchMessageUsage,
  readWorkbenchTurnStatistics,
} from "@workbench/agent-runtime-contracts/message-metadata";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { MessageSlotContext } from "@workbench/extension-sdk";

import { TooltipIconButton } from "../../../ui/tooltip-icon-button";
import { formatAdaptiveDuration } from "../../../format-duration";
import { useI18n } from "../../../i18n";
import { useWorkbenchNavigation } from "../../../navigation";
import { Button } from "../../../ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../../../ui/popover";

import { isExpectedForkUnavailableError } from "./fork-availability";
import { messageCacheHitRate, messageTokensPerSecond } from "./message-performance-statistics";
import { shouldShowMessagePerformance } from "./message-performance-visibility";

function MessagePerformance({ node }: Readonly<{ node: ConversationNode }>) {
  const custom = node.presentation?.custom;
  const timing = node.presentation?.timing;
  const usage = useMemo(
    () => readWorkbenchMessageUsage(custom?.workbenchUsage),
    [custom?.workbenchUsage],
  );
  const turnStatistics = useMemo(
    () => readWorkbenchTurnStatistics(custom?.workbenchTurnStatistics),
    [custom?.workbenchTurnStatistics],
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
      value: number(cacheHitRate, { style: "percent", maximumFractionDigits: 1 }),
    });
  }

  if (stats.length === 0) return null;
  const label = t("extensions.messageActions.timing.details");

  return (
    <div className="flex items-center">
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={100}
          closeDelay={100}
          render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} />}
        >
          <GaugeIcon />
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
    </div>
  );
}

function BranchPicker({ node }: Readonly<{ node: ConversationNode }>) {
  const { t } = useI18n();
  const session = useConversationSession();
  const reportError = useExtensionErrorReporter();
  const branch = node.presentation?.branch;
  if (!branch || branch.count <= 1 || !session.actions.selectBranch) return null;

  const select = (key: string | undefined) => {
    if (!key) return;
    void session.actions.selectBranch?.(key).catch((error) => {
      reportError(error, {
        source: "slot",
        contributionId: "message-actions.select-branch",
      });
    });
  };

  return (
    <div className="text-muted-foreground inline-flex items-center text-xs">
      <TooltipIconButton
        tooltip={t("extensions.messageActions.previousResponse")}
        type="button"
        disabled={!branch.previousKey}
        onClick={() => select(branch.previousKey)}
      >
        <ChevronLeftIcon />
      </TooltipIconButton>
      <span className="px-0.5 font-medium tabular-nums">
        {branch.index + 1} / {branch.count}
      </span>
      <TooltipIconButton
        tooltip={t("extensions.messageActions.nextResponse")}
        type="button"
        disabled={!branch.nextKey}
        onClick={() => select(branch.nextKey)}
      >
        <ChevronRightIcon />
      </TooltipIconButton>
    </div>
  );
}

function AssistantActions({ node }: Readonly<{ node: ConversationNode }>) {
  const { t } = useI18n();
  const session = useConversationSession();
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  const reportError = useExtensionErrorReporter();
  const navigation = useWorkbenchNavigation();
  const stateToken = readWorkbenchMessageStateToken(node.presentation?.custom?.workbenchStateToken);
  const [forkState, setForkState] = useState<"idle" | "pending" | "failed">("idle");
  const forkConversation = useCallback(async () => {
    if (!stateToken || !session.actions.fork || forkState === "pending") return;
    setForkState("pending");
    try {
      navigation.openConversation(await session.actions.fork(node.key));
    } catch (error) {
      setForkState("failed");
      if (!isExpectedForkUnavailableError(error)) {
        reportError(error, {
          source: "slot",
          contributionId: "message-actions.fork-conversation",
        });
      }
    }
  }, [forkState, navigation, node.key, reportError, session, stateToken]);
  const forkTooltip =
    forkState === "pending"
      ? t("extensions.messageActions.forkConversationPending")
      : forkState === "failed"
        ? t("extensions.messageActions.forkConversationFailed")
        : t("extensions.messageActions.forkConversation");
  const retry = () => {
    void session.actions.retry?.(node.key).catch((error) => {
      reportError(error, {
        source: "slot",
        contributionId: "message-actions.retry-response",
      });
    });
  };

  return (
    <div className="flex items-center">
      {stateToken && session.actions.fork ? (
        <TooltipIconButton
          tooltip={forkTooltip}
          type="button"
          disabled={forkState === "pending"}
          onClick={forkConversation}
        >
          <SplitIcon className="rotate-90" />
        </TooltipIconButton>
      ) : null}
      {session.actions.retry ? (
        <TooltipIconButton
          tooltip={t("extensions.messageActions.regenerateResponse")}
          type="button"
          disabled={isRunning}
          onClick={retry}
        >
          <RefreshCwIcon />
        </TooltipIconButton>
      ) : null}
    </div>
  );
}

export function MessageActions({ messageId, role, isLast }: MessageSlotContext) {
  const node = useConversationNode(messageId);
  const isRunning = useSessionState((snapshot) => snapshot.isRunning);
  if (!node) return null;
  const showPerformance = shouldShowMessagePerformance({ isLast, isRunning });

  return (
    <>
      {role === "assistant" ? (
        <>
          <AssistantActions node={node} />
          {showPerformance ? <MessagePerformance node={node} /> : null}
        </>
      ) : null}
      <BranchPicker node={node} />
    </>
  );
}
