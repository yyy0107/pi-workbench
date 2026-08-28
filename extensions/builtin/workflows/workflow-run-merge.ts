import type { WorkflowRunSummary } from "@/runtime/shared/execution";

function byUpdatedAt(left: WorkflowRunSummary, right: WorkflowRunSummary): number {
  return right.updatedAt - left.updatedAt;
}

function isAtLeastAsRecent(candidate: WorkflowRunSummary, current: WorkflowRunSummary): boolean {
  return (
    candidate.lastSeq > current.lastSeq ||
    (candidate.lastSeq === current.lastSeq && candidate.updatedAt >= current.updatedAt)
  );
}

/** Merge run snapshots without allowing delayed RPC responses to roll terminal state backwards. */
export function mergeWorkflowRuns(
  current: readonly WorkflowRunSummary[],
  incoming: readonly WorkflowRunSummary[],
  limit = 200,
): WorkflowRunSummary[] {
  const merged = new Map(current.map((run) => [run.id, run]));
  for (const candidate of incoming) {
    const existing = merged.get(candidate.id);
    if (!existing || isAtLeastAsRecent(candidate, existing)) merged.set(candidate.id, candidate);
  }
  return [...merged.values()].sort(byUpdatedAt).slice(0, limit);
}
