import type {
  SessionContextTraceEventSummary,
  SessionContextTracePromptInjection,
} from "@workbench/agent-runtime-pi-protocol/rpc";

/** Named assistant-ui Data Part carrying one safe Pi context-trace summary. */
export const WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME = "workbench.pi-context-trace-event";

const PI_CONTEXT_TRACE_PROMPT_INJECTIONS: readonly SessionContextTracePromptInjection[] = [
  "system-prompt",
  "tools",
  "extensions",
];

export function piContextTracePromptInjections(
  event: SessionContextTraceEventSummary,
): SessionContextTracePromptInjection[] {
  if (!Array.isArray(event.promptInjections)) return [];
  return [...new Set(event.promptInjections)].filter((injection) =>
    PI_CONTEXT_TRACE_PROMPT_INJECTIONS.includes(injection),
  );
}

export interface WorkbenchPiContextTraceDataV1 {
  readonly version: 1;
  readonly event: SessionContextTraceEventSummary;
  readonly promptInjection?: SessionContextTracePromptInjection;
}

const PI_CONTEXT_TRACE_KINDS = new Set<SessionContextTraceEventSummary["kind"]>([
  "round-start",
  "prompt-composition",
  "run-start",
  "turn-start",
  "context-snapshot",
  "provider-request",
  "provider-response",
  "model-output",
  "tool-execution-start",
  "tool-execution-end",
  "turn-end",
  "run-end",
  "retry",
  "compaction",
  "round-settled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function piContextTraceData(
  event: SessionContextTraceEventSummary,
  promptInjection?: SessionContextTracePromptInjection,
): WorkbenchPiContextTraceDataV1 {
  return { version: 1, event, ...(promptInjection ? { promptInjection } : {}) };
}

/** Tolerant parser used at the extension boundary; unknown future payloads render as no-op. */
export function parsePiContextTraceData(value: unknown): WorkbenchPiContextTraceDataV1 | undefined {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.event)) return undefined;
  if (
    value.promptInjection !== undefined &&
    !PI_CONTEXT_TRACE_PROMPT_INJECTIONS.includes(
      value.promptInjection as SessionContextTracePromptInjection,
    )
  ) {
    return undefined;
  }
  const event = value.event;
  if (
    event.schemaVersion !== 1 ||
    typeof event.traceId !== "string" ||
    typeof event.sessionId !== "string" ||
    typeof event.activationId !== "string" ||
    typeof event.seq !== "number" ||
    typeof event.time !== "number" ||
    typeof event.kind !== "string" ||
    !PI_CONTEXT_TRACE_KINDS.has(event.kind as SessionContextTraceEventSummary["kind"])
  ) {
    return undefined;
  }
  return value as unknown as WorkbenchPiContextTraceDataV1;
}
