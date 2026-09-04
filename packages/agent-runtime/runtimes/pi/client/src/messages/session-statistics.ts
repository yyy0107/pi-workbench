import type {
  PiConversationAssistantMessage as ThreadAssistantMessage,
  PiConversationMessage as ThreadMessage,
} from "../conversation/pi-conversation-message";

import { readPiUsage } from "./pi-usage";

export interface PiTurnStatistics {
  readonly steps: number;
  readonly llmDurationMs: number;
  readonly toolDurationMs: number;
  readonly firstTokenDurationMs: number;
  readonly firstTokenSamples: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface PiSessionStatistics extends PiTurnStatistics {
  readonly turns: number;
}

export function mergeMonotonicPiSessionStatistics(
  previous: PiSessionStatistics,
  current: PiSessionStatistics,
): PiSessionStatistics {
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

const EMPTY_TURN_STATISTICS: PiTurnStatistics = {
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

function nonNegativeInteger(value: unknown): number | undefined {
  const number = nonNegativeNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

export function readPiTurnStatistics(value: unknown): PiTurnStatistics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const statistics = value as Record<string, unknown>;
  const steps = nonNegativeInteger(statistics.steps);
  const llmDurationMs = nonNegativeNumber(statistics.llmDurationMs);
  const toolDurationMs = nonNegativeNumber(statistics.toolDurationMs);
  const firstTokenDurationMs = nonNegativeNumber(statistics.firstTokenDurationMs);
  const firstTokenSamples = nonNegativeInteger(statistics.firstTokenSamples);
  const inputTokens = nonNegativeNumber(statistics.inputTokens);
  const outputTokens = nonNegativeNumber(statistics.outputTokens);
  const cacheReadTokens = nonNegativeNumber(statistics.cacheReadTokens);
  const cacheWriteTokens = nonNegativeNumber(statistics.cacheWriteTokens);
  if (
    steps === undefined ||
    llmDurationMs === undefined ||
    toolDurationMs === undefined ||
    firstTokenDurationMs === undefined ||
    firstTokenSamples === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheReadTokens === undefined ||
    cacheWriteTokens === undefined
  ) {
    return undefined;
  }
  return {
    steps,
    llmDurationMs,
    toolDurationMs,
    firstTokenDurationMs,
    firstTokenSamples,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
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
): PiTurnStatistics {
  const stored = readPiTurnStatistics(message.metadata.custom.piTurnStatistics);
  if (stored) {
    return {
      ...stored,
      llmDurationMs: stored.llmDurationMs + activeLlmDuration(message, currentTime),
      // Tool timings can complete after an assistant message was first coalesced.
      toolDurationMs: toolDuration(message, currentTime),
    };
  }

  const timing = message.metadata.timing;
  const llmDurationMs =
    nonNegativeNumber(timing?.totalStreamTime) ?? activeLlmDuration(message, currentTime);
  const firstTokenTime = nonNegativeNumber(timing?.firstTokenTime);
  const usage = readPiUsage(message.metadata.custom.piUsage);
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

function addStatistics(total: PiTurnStatistics, addition: PiTurnStatistics): PiTurnStatistics {
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

export function aggregatePiTurnStatistics(
  messages: readonly ThreadAssistantMessage[],
): PiTurnStatistics {
  return messages.reduce(
    (total, message) => addStatistics(total, assistantStatistics(message)),
    EMPTY_TURN_STATISTICS,
  );
}

export function aggregatePiSessionStatistics(
  messages: readonly ThreadMessage[],
  currentTime?: number,
): PiSessionStatistics {
  let turns = 0;
  let statistics = EMPTY_TURN_STATISTICS;
  for (const message of messages) {
    if (message.role === "user") {
      turns += 1;
    } else if (message.role === "assistant") {
      statistics = addStatistics(statistics, assistantStatistics(message, currentTime));
    }
  }
  return { turns, ...statistics };
}
