interface MessageErrorVisibility {
  readonly isRunning: boolean;
  readonly terminationKind?: string;
}

/** A failed attempt becomes a terminal error only after the complete Pi run settles. */
export function shouldShowMessageError({
  isRunning,
  terminationKind,
}: MessageErrorVisibility): boolean {
  return !isRunning && terminationKind !== "completed";
}
