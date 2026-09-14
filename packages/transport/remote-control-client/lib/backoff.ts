export interface FullJitterBackoffOptions {
  readonly baseMs?: number;
  readonly capMs?: number;
}

export function fullJitterBackoffDelay(
  attempt: number,
  random: () => number,
  options: FullJitterBackoffOptions = {},
): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new RangeError("Reconnect attempt must be a non-negative safe integer");
  }
  const baseMs = options.baseMs ?? 1_000;
  const capMs = options.capMs ?? 30_000;
  if (!Number.isSafeInteger(baseMs) || baseMs <= 0 || !Number.isSafeInteger(capMs) || capMs <= 0) {
    throw new RangeError("Backoff base and cap must be positive safe integers");
  }
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError("Random sample must be in [0, 1)");
  }
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.min(attempt, 52));
  return Math.floor(sample * ceiling);
}
