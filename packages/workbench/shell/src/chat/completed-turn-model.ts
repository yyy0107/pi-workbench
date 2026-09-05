import { formatCompactDuration } from "../format-duration";

import type { MessageFormatters } from "../i18n";

interface MessageBlockLike {
  readonly kind: string;
}

/**
 * The last text part is the final answer body. Everything before it belongs
 * to the completed-work disclosure. A tool-only turn has no body, so all of
 * its parts are considered completed work.
 */
export function completedWorkBoundary(blocks: readonly MessageBlockLike[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.kind === "text") return index;
  }

  return blocks.length;
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

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

function localCalendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MILLISECONDS_PER_DAY;
}

export function formatCompletedAt(
  timestamp: Date | number,
  now: number,
  { date, relativeTime }: Pick<MessageFormatters, "date" | "relativeTime">,
): string {
  const completedAt = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const dayOffset = localCalendarDay(completedAt) - localCalendarDay(new Date(now));

  if (dayOffset === 0) {
    return date(completedAt, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  if (dayOffset === -1 || dayOffset === -2) {
    return relativeTime(dayOffset, "day");
  }

  return date(completedAt, { month: "long", day: "numeric" });
}
