import type { ThreadAssistantMessage, ThreadMessage } from "@assistant-ui/react";

import {
  readWorkbenchMessageUsage,
  readWorkbenchTurnStatistics,
  type WorkbenchTurnStatistics,
} from "@workbench/agent-runtime-contracts/message-metadata";

export interface WorkbenchSessionStatistics extends WorkbenchTurnStatistics {
  readonly turns: number;
}

const EMPTY_TURN_STATISTICS: WorkbenchTurnStatistics = {
  steps: 0,
  llmDurationMs: 0,
  toolDurationMs: 0,
  firstTokenDurationMs: 0,
  firstTokenSamples: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function toolDuration(message: ThreadAssistantMessage, currentTime?: number): number {
  return message.content.reduce((duration, part) => {
    if (part.type !== "tool-call") return duration;
    const startedAt = nonNegativeNumber(part.timing?.startedAt);
    const completedAt = nonNegativeNumber(part.timing?.completedAt);
    if (startedAt === undefined) return duration;
    if (completedAt !== undefined) {
      return completedAt < startedAt ? duration : duration + completedAt - startedAt;
    }
    return currentTime === undefined || currentTime < startedAt
      ? duration
      : duration + currentTime - startedAt;
  }, 0);
}

function activeLlmDuration(message: ThreadAssistantMessage, currentTime?: number): number {
  if (currentTime === undefined || message.status.type !== "running") return 0;
  const timing = message.metadata.timing;
  const streamStartTime = nonNegativeNumber(timing?.streamStartTime);
  if (
    streamStartTime === undefined ||
    timing?.totalStreamTime !== undefined ||
    currentTime < streamStartTime
  ) {
    return 0;
  }
  return currentTime - streamStartTime;
}

function assistantStatistics(
  message: ThreadAssistantMessage,
  currentTime?: number,
): WorkbenchTurnStatistics {
  const stored = readWorkbenchTurnStatistics(message.metadata.custom.workbenchTurnStatistics);
  if (stored) {
    return {
      ...stored,
      llmDurationMs: stored.llmDurationMs + activeLlmDuration(message, currentTime),
      toolDurationMs: toolDuration(message, currentTime),
    };
  }

  const timing = message.metadata.timing;
  const llmDurationMs =
    nonNegativeNumber(timing?.totalStreamTime) ?? activeLlmDuration(message, currentTime);
  const firstTokenTime = nonNegativeNumber(timing?.firstTokenTime);
  const usage = readWorkbenchMessageUsage(message.metadata.custom.workbenchUsage);
  return {
    steps: 1,
    llmDurationMs,
    toolDurationMs: toolDuration(message, currentTime),
    firstTokenDurationMs: firstTokenTime ?? 0,
    firstTokenSamples: firstTokenTime === undefined ? 0 : 1,
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    cacheReadTokens: usage?.cacheRead ?? 0,
    cacheWriteTokens: usage?.cacheWrite ?? 0,
  };
}

function addStatistics(
  total: WorkbenchTurnStatistics,
  addition: WorkbenchTurnStatistics,
): WorkbenchTurnStatistics {
  return {
    steps: total.steps + addition.steps,
    llmDurationMs: total.llmDurationMs + addition.llmDurationMs,
    toolDurationMs: total.toolDurationMs + addition.toolDurationMs,
    firstTokenDurationMs: total.firstTokenDurationMs + addition.firstTokenDurationMs,
    firstTokenSamples: total.firstTokenSamples + addition.firstTokenSamples,
    inputTokens: total.inputTokens + addition.inputTokens,
    outputTokens: total.outputTokens + addition.outputTokens,
    cacheReadTokens: total.cacheReadTokens + addition.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + addition.cacheWriteTokens,
  };
}

export function aggregateWorkbenchTurnStatistics(
  messages: readonly ThreadAssistantMessage[],
): WorkbenchTurnStatistics {
  return messages.reduce(
    (total, message) => addStatistics(total, assistantStatistics(message)),
    EMPTY_TURN_STATISTICS,
  );
}

export function aggregateWorkbenchSessionStatistics(
  messages: readonly ThreadMessage[],
  currentTime?: number,
): WorkbenchSessionStatistics {
  let turns = 0;
  let statistics = EMPTY_TURN_STATISTICS;
  for (const message of messages) {
    if (message.role === "user") turns += 1;
    else if (message.role === "assistant") {
      statistics = addStatistics(statistics, assistantStatistics(message, currentTime));
    }
  }
  return { turns, ...statistics };
}

export function mergeMonotonicWorkbenchSessionStatistics(
  previous: WorkbenchSessionStatistics,
  current: WorkbenchSessionStatistics,
): WorkbenchSessionStatistics {
  return {
    turns: Math.max(previous.turns, current.turns),
    steps: Math.max(previous.steps, current.steps),
    llmDurationMs: Math.max(previous.llmDurationMs, current.llmDurationMs),
    toolDurationMs: Math.max(previous.toolDurationMs, current.toolDurationMs),
    firstTokenDurationMs: Math.max(previous.firstTokenDurationMs, current.firstTokenDurationMs),
    firstTokenSamples: Math.max(previous.firstTokenSamples, current.firstTokenSamples),
    inputTokens: Math.max(previous.inputTokens, current.inputTokens),
    outputTokens: Math.max(previous.outputTokens, current.outputTokens),
    cacheReadTokens: Math.max(previous.cacheReadTokens, current.cacheReadTokens),
    cacheWriteTokens: Math.max(previous.cacheWriteTokens, current.cacheWriteTokens),
  };
}
