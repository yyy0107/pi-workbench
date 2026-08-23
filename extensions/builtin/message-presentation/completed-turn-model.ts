import { formatCompactDuration } from "@/lib/format-duration";
import { WORKBENCH_IMAGE_RECOGNITION_DATA_NAME } from "@/runtime/image-understanding/state-machine";

interface MessagePartLike {
  readonly type: string;
  readonly name?: string;
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
 * Completed-work disclosure belongs to assistant turns only. Recognition is a
 * turn-level assistant status, so it stays visible above the final answer
 * instead of being folded together with reasoning and tool work.
 */
export function partBelongsToCompletedWork(
  role: string,
  part: MessagePartLike,
  partIndex: number | undefined,
  boundary: number,
): boolean {
  return (
    role === "assistant" &&
    !(part.type === "data" && part.name === WORKBENCH_IMAGE_RECOGNITION_DATA_NAME) &&
    partIndex !== undefined &&
    partIndex < boundary
  );
}

export function formatCompletedDuration(milliseconds: number | undefined, locale: string): string {
  return formatCompactDuration(milliseconds, locale);
}
