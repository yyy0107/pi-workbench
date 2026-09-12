import type { WorkbenchSessionStatistics } from "@workbench/agent-runtime-client/message-statistics";

/** Current-step throughput while streaming; settled conversation throughput otherwise. */
export function sessionTokensPerSecond(
  statistics: WorkbenchSessionStatistics,
  includeLiveEstimate: boolean,
): number | undefined {
  if (includeLiveEstimate) {
    if (
      statistics.liveGeneratedTokens === undefined ||
      statistics.liveDecodeDurationMs === undefined ||
      statistics.liveDecodeDurationMs <= 0
    ) {
      return undefined;
    }
    return statistics.liveGeneratedTokens / (statistics.liveDecodeDurationMs / 1_000);
  }
  if (statistics.decodeDurationMs <= 0) return undefined;
  const generatedTokens = statistics.outputTokens + statistics.reasoningTokens;
  return generatedTokens / (statistics.decodeDurationMs / 1_000);
}
