import type { WorkbenchWorkspaceGitChangedFile } from "@workbench/agent-runtime-contracts/runtime-capabilities";

/** A committed render taking 1500 ms is enough to switch this comparison once. */
export const REVIEW_RENDER_BUDGET_MS = 1_500;

export function exceedsReviewRenderBudget(duration: number) {
  return Number.isFinite(duration) && duration >= REVIEW_RENDER_BUDGET_MS;
}

export function reviewFileWindow(
  files: readonly WorkbenchWorkspaceGitChangedFile[],
  nextOffset: number | undefined,
  requestedIndex: number,
  slowRender: boolean,
) {
  const singleFile = files.length > 0 && slowRender;
  const index = Math.max(0, Math.min(requestedIndex, files.length - 1));
  return {
    singleFile,
    index,
    visibleFiles: singleFile ? files.slice(index, index + 1) : files,
    hasPrevious: index > 0,
    hasNext: index + 1 < files.length || nextOffset !== undefined,
    nextNeedsPage: index + 1 >= files.length && nextOffset !== undefined,
    waitingForPage: requestedIndex >= files.length && nextOffset !== undefined,
  };
}
