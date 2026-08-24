import { formatCompactDuration } from "@/lib/format-duration";

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

/**
 * Completed-work disclosure belongs to assistant turns only. Data parts that
 * opt into the work timeline follow the same boundary as reasoning and tools.
 */
export function partBelongsToCompletedWork(
  role: string,
  partIndex: number | undefined,
  boundary: number,
): boolean {
  return role === "assistant" && partIndex !== undefined && partIndex < boundary;
}

export function formatCompletedDuration(milliseconds: number | undefined, locale: string): string {
  return formatCompactDuration(milliseconds, locale);
}
