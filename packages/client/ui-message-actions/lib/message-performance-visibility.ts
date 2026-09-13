interface MessagePerformanceVisibility {
  readonly isLast: boolean;
  readonly isRunning: boolean;
}

/** Keep completed-turn metrics visible while suppressing partial data for the active response. */
export function shouldShowMessagePerformance({
  isLast,
  isRunning,
}: MessagePerformanceVisibility): boolean {
  return !isLast || !isRunning;
}
