import type {
  AssistantMessageNode,
  ConversationNode,
} from "@workbench/agent-runtime-contracts/conversation";
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

function toolDuration(message: AssistantMessageNode, currentTime?: number): number {
  return message.blocks.reduce((duration, block) => {
    if (block.kind !== "tool-call") return duration;
    const startedAt = nonNegativeNumber(block.timing?.startedAt);
    const completedAt = nonNegativeNumber(block.timing?.completedAt);
    if (startedAt === undefined) return duration;
    if (completedAt !== undefined) {
      return completedAt < startedAt ? duration : duration + completedAt - startedAt;
    }
    return currentTime === undefined || currentTime < startedAt
      ? duration
      : duration + currentTime - startedAt;
  }, 0);
}

function activeLlmDuration(message: AssistantMessageNode, currentTime?: number): number {
  if (currentTime === undefined || message.status !== "running") return 0;
  const timing = message.presentation?.timing;
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
  message: AssistantMessageNode,
  currentTime?: number,
): WorkbenchTurnStatistics {
  const custom = message.presentation?.custom;
  const stored = readWorkbenchTurnStatistics(custom?.workbenchTurnStatistics);
  if (stored) {
    return {
      ...stored,
      llmDurationMs: stored.llmDurationMs + activeLlmDuration(message, currentTime),
      toolDurationMs: toolDuration(message, currentTime),
    };
  }

  const timing = message.presentation?.timing;
  const llmDurationMs =
    nonNegativeNumber(timing?.totalStreamTime) ?? activeLlmDuration(message, currentTime);
  const firstTokenTime = nonNegativeNumber(timing?.firstTokenTime);
  const usage = readWorkbenchMessageUsage(custom?.workbenchUsage);
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
  messages: readonly AssistantMessageNode[],
): WorkbenchTurnStatistics {
  return messages.reduce(
    (total, message) => addStatistics(total, assistantStatistics(message)),
    EMPTY_TURN_STATISTICS,
  );
}

export function aggregateWorkbenchSessionStatistics(
  nodes: readonly ConversationNode[],
  currentTime?: number,
): WorkbenchSessionStatistics {
  let turns = 0;
  let statistics = EMPTY_TURN_STATISTICS;
  for (const node of nodes) {
    if (node.kind === "user") turns += 1;
    else if (node.kind === "assistant") {
      statistics = addStatistics(statistics, assistantStatistics(node, currentTime));
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
