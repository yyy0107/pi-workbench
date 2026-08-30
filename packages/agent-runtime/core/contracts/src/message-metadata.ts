export const WORKBENCH_MESSAGE_METADATA_KEYS = Object.freeze({
  conversationEvent: "workbenchConversationEvent",
  stateToken: "workbenchStateToken",
  steerInterrupted: "workbenchSteerInterrupted",
  termination: "workbenchTermination",
  turnStatistics: "workbenchTurnStatistics",
  turnTiming: "workbenchTurnTiming",
  usage: "workbenchUsage",
} as const);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = nonNegativeNumber(value);
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}

export interface WorkbenchMessageUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens?: number;
}

export function readWorkbenchMessageUsage(value: unknown): WorkbenchMessageUsage | undefined {
  const usage = record(value);
  if (!usage) return undefined;
  const input = nonNegativeNumber(usage.input);
  const output = nonNegativeNumber(usage.output);
  const cacheRead = nonNegativeNumber(usage.cacheRead);
  const cacheWrite = nonNegativeNumber(usage.cacheWrite);
  const totalTokens =
    usage.totalTokens === undefined ? undefined : nonNegativeNumber(usage.totalTokens);
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    (usage.totalTokens !== undefined && totalTokens === undefined)
  ) {
    return undefined;
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

export type WorkbenchMessageTerminationKind =
  | "completed"
  | "cancelled"
  | "aborted"
  | "length"
  | "network-error"
  | "api-error"
  | "provider-error";

export interface WorkbenchMessageTermination {
  readonly schemaVersion: 1;
  readonly kind: WorkbenchMessageTerminationKind;
  readonly stopReason: string;
  readonly rawStopReason?: string;
  readonly errorMessage?: string;
  readonly source?: "workbench";
}

function terminationKind(value: unknown): WorkbenchMessageTerminationKind | undefined {
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

export function parseWorkbenchMessageTermination(
  value: unknown,
): WorkbenchMessageTermination | undefined {
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

export type WorkbenchConversationEvent =
  | Readonly<{
      kind: "model-change";
      model: string;
      provider?: string;
      previousModel?: string;
      previousProvider?: string;
    }>
  | Readonly<{
      kind: "compaction";
      reason: string;
      tokensBefore?: number;
      estimatedTokensAfter?: number;
    }>
  | Readonly<{
      kind: "fork";
      sourceThreadId?: string;
      sourceStateToken?: string;
    }>;

export function parseWorkbenchConversationEvent(
  value: unknown,
): WorkbenchConversationEvent | undefined {
  const candidate = record(value);
  if (candidate?.kind === "model-change") {
    const model = optionalString(candidate.model);
    if (!model) return undefined;
    return {
      kind: "model-change",
      model,
      ...(optionalString(candidate.provider) ? { provider: String(candidate.provider) } : {}),
      ...(optionalString(candidate.previousModel)
        ? { previousModel: String(candidate.previousModel) }
        : {}),
      ...(optionalString(candidate.previousProvider)
        ? { previousProvider: String(candidate.previousProvider) }
        : {}),
    };
  }
  if (candidate?.kind === "compaction") {
    const reason = optionalString(candidate.reason);
    if (!reason) return undefined;
    const tokensBefore = finiteNumber(candidate.tokensBefore);
    const estimatedTokensAfter = finiteNumber(candidate.estimatedTokensAfter);
    return {
      kind: "compaction",
      reason,
      ...(tokensBefore === undefined ? {} : { tokensBefore }),
      ...(estimatedTokensAfter === undefined ? {} : { estimatedTokensAfter }),
    };
  }
  if (candidate?.kind === "fork") {
    return {
      kind: "fork",
      ...(optionalString(candidate.sourceThreadId)
        ? { sourceThreadId: String(candidate.sourceThreadId) }
        : {}),
      ...(optionalString(candidate.sourceStateToken)
        ? { sourceStateToken: String(candidate.sourceStateToken) }
        : {}),
    };
  }
  return undefined;
}

export interface WorkbenchTurnTiming {
  readonly startedAt: number;
  readonly completedAt: number;
}

export function readWorkbenchTurnTiming(value: unknown): WorkbenchTurnTiming | undefined {
  const timing = record(value);
  const startedAt = finiteNumber(timing?.startedAt);
  const completedAt = finiteNumber(timing?.completedAt);
  if (startedAt === undefined || completedAt === undefined || completedAt < startedAt) {
    return undefined;
  }
  return { startedAt, completedAt };
}

export function resolveWorkbenchTurnDuration(
  value: unknown,
  fallbackStreamDuration?: number,
): number | undefined {
  const timing = readWorkbenchTurnTiming(value);
  if (timing) return timing.completedAt - timing.startedAt;
  return nonNegativeNumber(fallbackStreamDuration);
}

export interface WorkbenchTurnStatistics {
  readonly steps: number;
  readonly llmDurationMs: number;
  readonly toolDurationMs: number;
  readonly firstTokenDurationMs: number;
  readonly firstTokenSamples: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export function readWorkbenchTurnStatistics(value: unknown): WorkbenchTurnStatistics | undefined {
  const statistics = record(value);
  if (!statistics) return undefined;
  const steps = nonNegativeInteger(statistics.steps);
  const llmDurationMs = nonNegativeNumber(statistics.llmDurationMs);
  const toolDurationMs = nonNegativeNumber(statistics.toolDurationMs);
  const firstTokenDurationMs = nonNegativeNumber(statistics.firstTokenDurationMs);
  const firstTokenSamples = nonNegativeInteger(statistics.firstTokenSamples);
  const inputTokens = nonNegativeNumber(statistics.inputTokens);
  const outputTokens = nonNegativeNumber(statistics.outputTokens);
  const cacheReadTokens = nonNegativeNumber(statistics.cacheReadTokens);
  const cacheWriteTokens = nonNegativeNumber(statistics.cacheWriteTokens);
  if (
    steps === undefined ||
    llmDurationMs === undefined ||
    toolDurationMs === undefined ||
    firstTokenDurationMs === undefined ||
    firstTokenSamples === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheReadTokens === undefined ||
    cacheWriteTokens === undefined
  ) {
    return undefined;
  }
  return {
    steps,
    llmDurationMs,
    toolDurationMs,
    firstTokenDurationMs,
    firstTokenSamples,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/** Opaque runtime-owned state token echoed back only to the implementation that produced it. */
export function readWorkbenchMessageStateToken(value: unknown): string | undefined {
  return optionalString(value);
}
