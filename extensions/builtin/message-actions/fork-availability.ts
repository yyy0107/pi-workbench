/** A canonical message_end sequence identifies a candidate Pi message fork boundary. */
export function assistantForkEventSequence(eventSeq: unknown): number | undefined {
  return typeof eventSeq === "number" && Number.isSafeInteger(eventSeq) && eventSeq >= 0
    ? eventSeq
    : undefined;
}

/** A boundary can disappear if the session advances or is interrupted after the UI snapshot. */
export function isExpectedForkUnavailableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "fork-unavailable"
  );
}
