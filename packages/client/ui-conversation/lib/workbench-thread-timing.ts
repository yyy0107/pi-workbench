import type { ConversationRunTiming } from "@workbench/agent-runtime-contracts/conversation";

/** Advance a server elapsed-time baseline with a monotonic browser clock for smooth display. */
export function displayedAgentRunElapsedMs(timing: ConversationRunTiming, now: number): number {
  return timing.elapsedMs + Math.max(0, now - timing.observedAt);
}
