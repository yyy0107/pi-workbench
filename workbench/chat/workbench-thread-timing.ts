export interface PiAutoRetryStatus {
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface PiRunTimingStatus {
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly observedAt: number;
}

/** Read the server-authoritative active-run timing snapshot from assistant-ui thread extras. */
export function piRunTiming(extras: unknown): PiRunTimingStatus | undefined {
  if (!extras || typeof extras !== "object" || !("piRun" in extras)) return undefined;
  const piRun = extras.piRun;
  if (!piRun || typeof piRun !== "object" || !("timing" in piRun)) return undefined;
  const timing = piRun.timing;
  if (!timing || typeof timing !== "object") return undefined;
  if (!("startedAt" in timing) || !("elapsedMs" in timing) || !("observedAt" in timing)) {
    return undefined;
  }
  const { startedAt, elapsedMs, observedAt } = timing;
  if (
    typeof startedAt !== "number" ||
    !Number.isFinite(startedAt) ||
    startedAt < 0 ||
    typeof elapsedMs !== "number" ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    typeof observedAt !== "number" ||
    !Number.isFinite(observedAt) ||
    observedAt < 0
  ) {
    return undefined;
  }
  return timing as PiRunTimingStatus;
}

/** Advance a server elapsed-time baseline with a monotonic browser clock for smooth display. */
export function displayedPiRunElapsedMs(timing: PiRunTimingStatus, now: number): number {
  return timing.elapsedMs + Math.max(0, now - timing.observedAt);
}

/** Read the active automatic-retry attempt from assistant-ui thread extras. */
export function piAutoRetryStatus(extras: unknown): PiAutoRetryStatus | undefined {
  if (!extras || typeof extras !== "object" || !("piRun" in extras)) return undefined;
  const piRun = extras.piRun;
  if (!piRun || typeof piRun !== "object" || !("autoRetry" in piRun)) return undefined;
  const autoRetry = piRun.autoRetry;
  if (!autoRetry || typeof autoRetry !== "object") return undefined;
  if (!("attempt" in autoRetry) || !("maxAttempts" in autoRetry)) return undefined;
  const { attempt, maxAttempts } = autoRetry;
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
  return autoRetry as PiAutoRetryStatus;
}
