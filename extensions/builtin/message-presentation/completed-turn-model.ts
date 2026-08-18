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

  const units = [
    { seconds: 86_400, suffix: "d" },
    { seconds: 3_600, suffix: "h" },
    { seconds: 60, suffix: "m" },
    { seconds: 1, suffix: "s" },
  ] as const;
  let remaining = totalSeconds;

  return units
    .flatMap((unit) => {
      const value = Math.floor(remaining / unit.seconds);
      remaining %= unit.seconds;
      return value === 0 ? [] : `${value}${unit.suffix}`;
    })
    .join("");
}
