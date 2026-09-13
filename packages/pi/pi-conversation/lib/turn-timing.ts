export interface PiTurnTiming {
  readonly startedAt: number;
  readonly completedAt: number;
}

export function readPiTurnTiming(value: unknown): PiTurnTiming | undefined {
  if (!value || typeof value !== "object") return undefined;
  const timing = value as { startedAt?: unknown; completedAt?: unknown };
  if (
    typeof timing.startedAt !== "number" ||
    typeof timing.completedAt !== "number" ||
    !Number.isFinite(timing.startedAt) ||
    !Number.isFinite(timing.completedAt) ||
    timing.completedAt < timing.startedAt
  ) {
    return undefined;
  }

  return { startedAt: timing.startedAt, completedAt: timing.completedAt };
}

export function resolvePiTurnDuration(
  value: unknown,
  fallbackStreamDuration?: number,
): number | undefined {
  const timing = readPiTurnTiming(value);
  if (timing) return timing.completedAt - timing.startedAt;

  return typeof fallbackStreamDuration === "number" &&
    Number.isFinite(fallbackStreamDuration) &&
    fallbackStreamDuration >= 0
    ? fallbackStreamDuration
    : undefined;
}
