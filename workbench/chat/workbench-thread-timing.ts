import type {
  WorkbenchAgentAutoRetry,
  WorkbenchAgentRunTiming,
} from "@/runtime/assistant-ui/agent-runtime-adapter";

/** Read the server-authoritative active-run timing snapshot from assistant-ui thread extras. */
export function agentRunTiming(extras: unknown): WorkbenchAgentRunTiming | undefined {
  if (!extras || typeof extras !== "object" || !("agentRun" in extras)) return undefined;
  const agentRun = extras.agentRun;
  if (!agentRun || typeof agentRun !== "object" || !("timing" in agentRun)) return undefined;
  const timing = agentRun.timing;
  if (!timing || typeof timing !== "object") return undefined;
  if (!("startedAt" in timing) || !("elapsedMs" in timing) || !("observedAt" in timing)) {
    return undefined;
  }
  const { startedAt, elapsedMs, observedAt } = timing;
  if (
    typeof startedAt !== "number" ||
    !Number.isFinite(startedAt) ||
    startedAt < 0 ||
    typeof elapsedMs !== "number" ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    typeof observedAt !== "number" ||
    !Number.isFinite(observedAt) ||
    observedAt < 0
  ) {
    return undefined;
  }
  return timing as WorkbenchAgentRunTiming;
}

/** Advance a server elapsed-time baseline with a monotonic browser clock for smooth display. */
export function displayedAgentRunElapsedMs(timing: WorkbenchAgentRunTiming, now: number): number {
  return timing.elapsedMs + Math.max(0, now - timing.observedAt);
}

/** Read the active automatic-retry attempt from assistant-ui thread extras. */
export function agentAutoRetryStatus(extras: unknown): WorkbenchAgentAutoRetry | undefined {
  if (!extras || typeof extras !== "object" || !("agentRun" in extras)) return undefined;
  const agentRun = extras.agentRun;
  if (!agentRun || typeof agentRun !== "object" || !("autoRetry" in agentRun)) return undefined;
  const autoRetry = agentRun.autoRetry;
  if (!autoRetry || typeof autoRetry !== "object") return undefined;
  if (!("attempt" in autoRetry) || !("maxAttempts" in autoRetry)) return undefined;
  const { attempt, maxAttempts } = autoRetry;
  if (
    typeof attempt !== "number" ||
    !Number.isInteger(attempt) ||
    attempt <= 0 ||
    typeof maxAttempts !== "number" ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < attempt
  ) {
    return undefined;
  }
  return autoRetry as WorkbenchAgentAutoRetry;
}
