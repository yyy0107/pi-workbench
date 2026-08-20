import type { PiSessionStatistics } from "@/runtime/pi/client/messages/session-statistics";

export const TOKEN_ANIMATION_DURATION_MS = 500;

export interface TokenQuantities {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export function tokenQuantities(statistics: PiSessionStatistics): TokenQuantities {
  return {
    inputTokens: statistics.inputTokens,
    outputTokens: statistics.outputTokens,
    cacheReadTokens: statistics.cacheReadTokens,
    cacheWriteTokens: statistics.cacheWriteTokens,
  };
}

export function interpolateTokenQuantities(
  from: TokenQuantities,
  target: TokenQuantities,
  progress: number,
): TokenQuantities {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const interpolate = (start: number, end: number) =>
    start + (Math.max(start, end) - start) * clampedProgress;

  return {
    inputTokens: interpolate(from.inputTokens, target.inputTokens),
    outputTokens: interpolate(from.outputTokens, target.outputTokens),
    cacheReadTokens: interpolate(from.cacheReadTokens, target.cacheReadTokens),
    cacheWriteTokens: interpolate(from.cacheWriteTokens, target.cacheWriteTokens),
  };
}

export function tokenQuantitiesEqual(left: TokenQuantities, right: TokenQuantities): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens
  );
}
