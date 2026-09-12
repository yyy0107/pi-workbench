export interface PiUsageMetadata {
  readonly input: number;
  readonly output: number;
  /** Reasoning/thinking tokens; Pi's output field includes them. */
  readonly reasoning?: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens?: number;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Reads the Pi usage metadata shared by message projections and presentation extensions. */
export function readPiUsage(value: unknown): PiUsageMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const input = nonNegativeNumber(usage.input);
  const output = nonNegativeNumber(usage.output);
  const reasoning = usage.reasoning === undefined ? undefined : nonNegativeNumber(usage.reasoning);
  const cacheRead = nonNegativeNumber(usage.cacheRead);
  const cacheWrite = nonNegativeNumber(usage.cacheWrite);
  const totalTokens =
    usage.totalTokens === undefined ? undefined : nonNegativeNumber(usage.totalTokens);
  if (
    input === undefined ||
    output === undefined ||
    (usage.reasoning !== undefined && reasoning === undefined) ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    (usage.totalTokens !== undefined && totalTokens === undefined)
  ) {
    return undefined;
  }
  return {
    input,
    output,
    ...(reasoning === undefined ? {} : { reasoning }),
    cacheRead,
    cacheWrite,
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

/** Pi reports reasoning as a subset of output; keep only the final-answer portion. */
export function visibleOutputTokens(usage: Pick<PiUsageMetadata, "output" | "reasoning">): number {
  return Math.max(0, usage.output - (usage.reasoning ?? 0));
}
