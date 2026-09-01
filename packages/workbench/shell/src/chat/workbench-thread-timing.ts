import type { WorkbenchAgentRunTiming } from "@workbench/agent-runtime-client/adapter";
import { readAgentAutoRetry, readAgentRunTiming } from "@workbench/agent-runtime-client/extras";

/** Read the server-authoritative active-run timing snapshot from assistant-ui thread extras. */
export const agentRunTiming = readAgentRunTiming;

/** Advance a server elapsed-time baseline with a monotonic browser clock for smooth display. */
export function displayedAgentRunElapsedMs(timing: WorkbenchAgentRunTiming, now: number): number {
  return timing.elapsedMs + Math.max(0, now - timing.observedAt);
}

/** Read the active automatic-retry attempt from assistant-ui thread extras. */
export const agentAutoRetryStatus = readAgentAutoRetry;
