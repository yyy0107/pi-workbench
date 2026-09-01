import type { PiEvent } from "@workbench/agent-runtime-pi-protocol/messages";
import type { SessionHistoryValue } from "@workbench/agent-runtime-pi-protocol/rpc";

export interface PiAutoRetrySnapshot {
  readonly attempt: number;
  readonly maxAttempts: number;
}

function retrySnapshot(value: unknown): PiAutoRetrySnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (!("attempt" in value) || !("maxAttempts" in value)) return undefined;
  const { attempt, maxAttempts } = value;
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
  return { attempt, maxAttempts };
}

export function piAutoRetryFromEvent(event: PiEvent): PiAutoRetrySnapshot | undefined {
  return event.type === "auto_retry_start" ? retrySnapshot(event) : undefined;
}

/** Recover an in-flight retry from canonical history after a refresh or stream rebaseline. */
export function piAutoRetryFromHistory(
  history: SessionHistoryValue,
): PiAutoRetrySnapshot | undefined {
  for (let index = history.events.length - 1; index >= 0; index -= 1) {
    const event = history.events[index]?.event;
    if (!event) continue;
    if (
      event.type === "agent_settled" ||
      event.type === "command_done" ||
      event.type === "command_error"
    ) {
      return undefined;
    }
    if (event.type === "auto_retry_start") return retrySnapshot(event.data);
  }
  return undefined;
}
