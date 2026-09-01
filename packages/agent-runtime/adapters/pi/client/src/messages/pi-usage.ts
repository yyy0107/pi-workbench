export interface PiUsageMetadata {
  readonly input: number;
  readonly output: number;
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
