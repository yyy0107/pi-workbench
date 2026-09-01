import type { WorkflowRunSummary } from "@workbench/execution-contracts";

import { mergeWorkflowRuns } from "./execution-run-merge";

interface ReconcileWorkflowRunBaselineOptions {
  baseline: readonly WorkflowRunSummary[];
  live: readonly WorkflowRunSummary[];
  knownLiveRunIds: ReadonlySet<string>;
  removedRunIds: ReadonlySet<string>;
  limit?: number;
}

/**
 * Treat the RPC response as the authoritative membership baseline while preserving live runs that
 * appeared after the request started and newer live versions of baseline runs.
 */
export function reconcileWorkflowRunBaseline({
  baseline,
  live,
  knownLiveRunIds,
  removedRunIds,
  limit = 200,
}: ReconcileWorkflowRunBaselineOptions): WorkflowRunSummary[] {
  const baselineRunIds = new Set(baseline.map(({ id }) => id));
  const availableBaseline = baseline.filter(({ id }) => !removedRunIds.has(id));
  const relevantLive = live.filter(
    ({ id }) => !removedRunIds.has(id) && (baselineRunIds.has(id) || !knownLiveRunIds.has(id)),
  );

  return mergeWorkflowRuns(availableBaseline, relevantLive, limit);
}
