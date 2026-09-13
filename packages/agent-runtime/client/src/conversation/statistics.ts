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
  /** Generated tokens from an active stream; used only for live throughput. */
  readonly liveGeneratedTokens?: number;
  /** Decode time paired with liveGeneratedTokens; never mixed into settled throughput. */
  readonly liveDecodeDurationMs?: number;
}

interface WorkbenchAssistantStatistics extends WorkbenchTurnStatistics {
  /** Generated tokens from this active stream; never shown as final-answer output. */
  readonly liveGeneratedTokens?: number;
  /** Decode time for this active stream only. */
  readonly liveDecodeDurationMs?: number;
}

const EMPTY_TURN_STATISTICS: WorkbenchTurnStatistics = {
  steps: 0,
  llmDurationMs: 0,
  decodeDurationMs: 0,
  toolDurationMs: 0,
  firstTokenDurationMs: 0,
  firstTokenSamples: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function liveGeneratedTokens(message: AssistantMessageNode): number | undefined {
  if (message.status !== "running") return undefined;
  return nonNegativeNumber(message.presentation?.timing?.tokenCount);
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

function activeDecodeDuration(message: AssistantMessageNode, currentTime?: number): number {
  if (currentTime === undefined || message.status !== "running") return 0;
  const timing = message.presentation?.timing;
  const streamStartTime = nonNegativeNumber(timing?.streamStartTime);
  const firstTokenTime = nonNegativeNumber(timing?.firstTokenTime);
  if (
    streamStartTime === undefined ||
    firstTokenTime === undefined ||
    timing?.totalStreamTime !== undefined ||
    currentTime < streamStartTime + firstTokenTime
  ) {
    return 0;
  }
  return currentTime - streamStartTime - firstTokenTime;
}

function assistantStatistics(
  message: AssistantMessageNode,
  currentTime?: number,
): WorkbenchAssistantStatistics {
  const custom = message.presentation?.custom;
  const stored = readWorkbenchTurnStatistics(custom?.workbenchTurnStatistics);
  if (stored) {
    const activeGeneratedTokens = liveGeneratedTokens(message);
    const liveDecodeDurationMs =
      activeGeneratedTokens === undefined ? undefined : activeDecodeDuration(message, currentTime);
    return {
      ...stored,
      llmDurationMs: stored.llmDurationMs + activeLlmDuration(message, currentTime),
      toolDurationMs: toolDuration(message, currentTime),
      ...(activeGeneratedTokens === undefined
        ? {}
        : { liveGeneratedTokens: activeGeneratedTokens }),
      ...(liveDecodeDurationMs === undefined ? {} : { liveDecodeDurationMs }),
    };
  }

  const timing = message.presentation?.timing;
  const llmDurationMs =
    nonNegativeNumber(timing?.totalStreamTime) ?? activeLlmDuration(message, currentTime);
  const firstTokenTime = nonNegativeNumber(timing?.firstTokenTime);
  const decodeDurationMs =
    timing?.totalStreamTime === undefined ? 0 : Math.max(0, llmDurationMs - (firstTokenTime ?? 0));
  const usage = readWorkbenchMessageUsage(custom?.workbenchUsage);
  const activeGeneratedTokens = liveGeneratedTokens(message);
  const liveDecodeDurationMs =
    activeGeneratedTokens === undefined ? undefined : activeDecodeDuration(message, currentTime);
  return {
    steps: 1,
    llmDurationMs,
    decodeDurationMs,
    toolDurationMs: toolDuration(message, currentTime),
    firstTokenDurationMs: firstTokenTime ?? 0,
    firstTokenSamples: firstTokenTime === undefined ? 0 : 1,
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    reasoningTokens: usage?.reasoning ?? 0,
    cacheReadTokens: usage?.cacheRead ?? 0,
    cacheWriteTokens: usage?.cacheWrite ?? 0,
    ...(activeGeneratedTokens === undefined ? {} : { liveGeneratedTokens: activeGeneratedTokens }),
    ...(liveDecodeDurationMs === undefined ? {} : { liveDecodeDurationMs }),
  };
}

function addStatistics(
  total: WorkbenchTurnStatistics,
  addition: WorkbenchTurnStatistics,
): WorkbenchTurnStatistics {
  return {
    steps: total.steps + addition.steps,
    llmDurationMs: total.llmDurationMs + addition.llmDurationMs,
    decodeDurationMs: total.decodeDurationMs + addition.decodeDurationMs,
    toolDurationMs: total.toolDurationMs + addition.toolDurationMs,
    firstTokenDurationMs: total.firstTokenDurationMs + addition.firstTokenDurationMs,
    firstTokenSamples: total.firstTokenSamples + addition.firstTokenSamples,
    inputTokens: total.inputTokens + addition.inputTokens,
    outputTokens: total.outputTokens + addition.outputTokens,
    reasoningTokens: total.reasoningTokens + addition.reasoningTokens,
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
  let liveGeneratedTokens: number | undefined;
  let liveDecodeDurationMs: number | undefined;
  for (const node of nodes) {
    if (node.kind === "user") turns += 1;
    else if (node.kind === "assistant") {
      const addition = assistantStatistics(node, currentTime);
      statistics = addStatistics(statistics, addition);
      if (addition.liveGeneratedTokens !== undefined) {
        liveGeneratedTokens = (liveGeneratedTokens ?? 0) + addition.liveGeneratedTokens;
      }
      if (addition.liveDecodeDurationMs !== undefined) {
        liveDecodeDurationMs = (liveDecodeDurationMs ?? 0) + addition.liveDecodeDurationMs;
      }
    }
  }
  return {
    turns,
    ...statistics,
    ...(liveGeneratedTokens === undefined ? {} : { liveGeneratedTokens }),
    ...(liveDecodeDurationMs === undefined ? {} : { liveDecodeDurationMs }),
  };
}

export function mergeMonotonicWorkbenchSessionStatistics(
  previous: WorkbenchSessionStatistics,
  current: WorkbenchSessionStatistics,
): WorkbenchSessionStatistics {
  return {
    turns: Math.max(previous.turns, current.turns),
    steps: Math.max(previous.steps, current.steps),
    llmDurationMs: Math.max(previous.llmDurationMs, current.llmDurationMs),
    decodeDurationMs: Math.max(previous.decodeDurationMs, current.decodeDurationMs),
    toolDurationMs: Math.max(previous.toolDurationMs, current.toolDurationMs),
    firstTokenDurationMs: Math.max(previous.firstTokenDurationMs, current.firstTokenDurationMs),
    firstTokenSamples: Math.max(previous.firstTokenSamples, current.firstTokenSamples),
    inputTokens: Math.max(previous.inputTokens, current.inputTokens),
    outputTokens: Math.max(previous.outputTokens, current.outputTokens),
    reasoningTokens: Math.max(previous.reasoningTokens, current.reasoningTokens),
    cacheReadTokens: Math.max(previous.cacheReadTokens, current.cacheReadTokens),
    cacheWriteTokens: Math.max(previous.cacheWriteTokens, current.cacheWriteTokens),
    // The active estimate may reset when a model step completes; finalized usage absorbs it.
    ...(current.liveGeneratedTokens === undefined
      ? {}
      : { liveGeneratedTokens: current.liveGeneratedTokens }),
    ...(current.liveDecodeDurationMs === undefined
      ? {}
      : { liveDecodeDurationMs: current.liveDecodeDurationMs }),
  };
}
