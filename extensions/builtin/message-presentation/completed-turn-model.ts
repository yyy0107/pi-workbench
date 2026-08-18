interface MessagePartLike {
  readonly type: string;
}

/**
 * The last text part is the final answer body. Everything before it belongs
 * to the completed-work disclosure. A tool-only turn has no body, so all of
 * its parts are considered completed work.
 */
export function completedWorkBoundary(parts: readonly MessagePartLike[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === "text") return index;
  }

  return parts.length;
}

export function formatCompletedDuration(milliseconds: number | undefined): string {
  const totalSeconds = Math.max(0, Math.round((milliseconds ?? 0) / 1_000));
  if (totalSeconds === 0) return "";

  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours === 0 && minutes === 0) return `${seconds}s`;
  if (hours === 0) return `${minutes}m${seconds}s`;
  return `${hours}h${minutes}m${seconds}s`;
}
