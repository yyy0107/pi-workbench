import type { SessionContextTraceActivationSummary } from "@/workbench/runtime-contributions/pi/protocol/rpc";

/**
 * Keep the current activation implicit when it has events so the live subscription stays active.
 * If the current activation is empty (for example after a host reload), fall back to the newest
 * durable activation that can actually populate the timeline.
 */
export function selectContextTraceActivation(
  activations: readonly SessionContextTraceActivationSummary[],
  currentActivationId: string | undefined,
): string | undefined {
  const current = activations.find((activation) => activation.activationId === currentActivationId);
  if (current && current.eventCount > 0) return undefined;

  const latestWithEvents = activations
    .filter((activation) => activation.eventCount > 0)
    .toSorted((left, right) => right.startedAt - left.startedAt)[0];
  return latestWithEvents?.activationId === currentActivationId
    ? undefined
    : latestWithEvents?.activationId;
}
