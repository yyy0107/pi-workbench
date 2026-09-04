import type {
  PiAssistantMessage,
  PiAssistantMessageDiagnostic,
} from "@workbench/agent-runtime-pi-protocol/messages";

export const PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE = "workbench.message-termination.v1";
export const PI_CANCEL_INTENT_CUSTOM_TYPE = "workbench.cancel-intent.v1";

export type PiMessageTerminationKind =
  | "completed"
  | "cancelled"
  | "aborted"
  | "length"
  | "network-error"
  | "api-error"
  | "provider-error";

export interface PiMessageTermination {
  schemaVersion: 1;
  kind: PiMessageTerminationKind;
  stopReason: string;
  rawStopReason?: string;
  errorMessage?: string;
  source?: "workbench";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function terminationKind(value: unknown): PiMessageTerminationKind | undefined {
  switch (value) {
    case "completed":
    case "cancelled":
    case "aborted":
    case "length":
    case "network-error":
    case "api-error":
    case "provider-error":
      return value;
    default:
      return undefined;
  }
}

export function parsePiMessageTermination(value: unknown): PiMessageTermination | undefined {
  const candidate = record(value);
  const kind = terminationKind(candidate?.kind);
  const stopReason = optionalString(candidate?.stopReason);
  if (candidate?.schemaVersion !== 1 || !kind || !stopReason) return undefined;

  return {
    schemaVersion: 1,
    kind,
    stopReason,
    ...(optionalString(candidate.rawStopReason)
      ? { rawStopReason: String(candidate.rawStopReason) }
      : {}),
    ...(optionalString(candidate.errorMessage)
      ? { errorMessage: String(candidate.errorMessage) }
      : {}),
    ...(candidate.source === "workbench" ? { source: "workbench" as const } : {}),
  };
}

export function terminationFromDiagnostics(
  diagnostics: readonly PiAssistantMessageDiagnostic[] | undefined,
): PiMessageTermination | undefined {
  for (let index = (diagnostics?.length ?? 0) - 1; index >= 0; index -= 1) {
    const diagnostic = diagnostics?.[index];
    if (diagnostic?.type !== PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE) continue;
    const termination = parsePiMessageTermination(diagnostic.details);
    if (termination) return termination;
  }
  return undefined;
}

export function terminationFromAssistantMessage(
  message: Pick<PiAssistantMessage, "diagnostics">,
): PiMessageTermination | undefined {
  return terminationFromDiagnostics(message.diagnostics);
}
