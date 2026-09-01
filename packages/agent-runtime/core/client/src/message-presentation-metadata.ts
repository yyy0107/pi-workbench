import type { PartProviderMetadata } from "@assistant-ui/react";

export interface WorkbenchReasoningPresentationMetadata {
  readonly startedAt?: number;
  readonly durationMs?: number;
}

export interface WorkbenchParallelToolPresentationMetadata {
  readonly batchId: string;
  readonly batchSize: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Creates provider metadata that any agent runtime can use for reasoning presentation. */
export function createWorkbenchReasoningPresentationMetadata({
  startedAt,
  durationMs,
}: WorkbenchReasoningPresentationMetadata): PartProviderMetadata | undefined {
  const normalizedStart = finiteNumber(startedAt);
  const finiteDuration = finiteNumber(durationMs);
  const normalizedDuration =
    finiteDuration !== undefined && finiteDuration >= 0 ? finiteDuration : undefined;
  if (normalizedStart === undefined && normalizedDuration === undefined) return undefined;

  return {
    workbench: {
      reasoningTiming: {
        ...(normalizedStart === undefined ? {} : { startedAt: normalizedStart }),
        ...(normalizedDuration === undefined ? {} : { durationMs: normalizedDuration }),
      },
    },
  };
}

/** Reads the generic reasoning presentation metadata emitted by an installed runtime. */
export function readWorkbenchReasoningPresentationMetadata(
  providerMetadata: unknown,
): WorkbenchReasoningPresentationMetadata | undefined {
  const timing = asRecord(asRecord(asRecord(providerMetadata)?.workbench)?.reasoningTiming);
  const startedAt = finiteNumber(timing?.startedAt);
  const durationMs = finiteNumber(timing?.durationMs);
  const normalizedDuration = durationMs !== undefined && durationMs >= 0 ? durationMs : undefined;
  if (startedAt === undefined && normalizedDuration === undefined) return undefined;
  return {
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(normalizedDuration === undefined ? {} : { durationMs: normalizedDuration }),
  };
}

/** Creates provider metadata used to group adjacent parallel tool calls in presentation. */
export function createWorkbenchParallelToolPresentationMetadata(
  batchId: string,
  batchSize: number,
): PartProviderMetadata | undefined {
  const normalizedId = batchId.trim();
  if (!normalizedId || !Number.isInteger(batchSize) || batchSize <= 1) return undefined;
  return {
    workbench: {
      parallelToolBatch: {
        id: normalizedId,
        size: batchSize,
      },
    },
  };
}

/** Reads generic parallel-tool presentation metadata emitted by an installed runtime. */
export function readWorkbenchParallelToolPresentationMetadata(
  providerMetadata: unknown,
): WorkbenchParallelToolPresentationMetadata | undefined {
  const batch = asRecord(asRecord(asRecord(providerMetadata)?.workbench)?.parallelToolBatch);
  const batchId = typeof batch?.id === "string" ? batch.id.trim() : "";
  const batchSize = finiteNumber(batch?.size);
  return batchId && batchSize !== undefined && Number.isInteger(batchSize) && batchSize > 1
    ? { batchId, batchSize }
    : undefined;
}
