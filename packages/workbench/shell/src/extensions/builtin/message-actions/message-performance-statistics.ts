import type {
  WorkbenchMessageUsage,
  WorkbenchTurnStatistics,
} from "@workbench/agent-runtime-contracts/message-metadata";

interface MessageCacheHitRateOptions {
  readonly turnStatistics?: WorkbenchTurnStatistics;
  readonly usage?: WorkbenchMessageUsage;
}

interface MessageTokensPerSecondOptions {
  readonly turnStatistics?: WorkbenchTurnStatistics;
  readonly timingTokensPerSecond?: number;
}

/** Returns the token-weighted prompt-cache hit rate for the whole assistant turn. */
export function messageCacheHitRate({
  turnStatistics,
  usage,
}: MessageCacheHitRateOptions): number | undefined {
  const inputTokens = turnStatistics?.inputTokens ?? usage?.input;
  const cacheReadTokens = turnStatistics?.cacheReadTokens ?? usage?.cacheRead;
  const cacheWriteTokens = turnStatistics?.cacheWriteTokens ?? usage?.cacheWrite;
  if (
    inputTokens === undefined ||
    cacheReadTokens === undefined ||
    cacheWriteTokens === undefined
  ) {
    return undefined;
  }

  const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  return promptTokens > 0 ? cacheReadTokens / promptTokens : undefined;
}

/** Returns aggregate output throughput across every LLM step in the assistant turn. */
export function messageTokensPerSecond({
  turnStatistics,
  timingTokensPerSecond,
}: MessageTokensPerSecondOptions): number | undefined {
  if (turnStatistics) {
    return turnStatistics.llmDurationMs > 0
      ? turnStatistics.outputTokens / (turnStatistics.llmDurationMs / 1_000)
      : undefined;
  }
  return timingTokensPerSecond;
}
