import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowRunSummary } from "@/runtime/shared/execution";

import { reconcileWorkflowRunBaseline } from "./execution-run-baseline";

function run(
  id: string,
  status: WorkflowRunSummary["status"],
  lastSeq: number,
  updatedAt = lastSeq,
): WorkflowRunSummary {
  return {
    schemaVersion: 1,
    id,
    workflowId: "workflow-1",
    workflowName: "Daily review",
    workflowKind: "workflow",
    revisionId: "revision-1",
    source: "schedule",
    status,
    createdAt: updatedAt,
    updatedAt,
    lastSeq,
    attempts: [],
  };
}

test("restores a run missing from the live cache using the authoritative baseline", () => {
  const missing = run("run-missing", "succeeded", 8);

  assert.deepEqual(
    reconcileWorkflowRunBaseline({
      baseline: [missing],
      live: [],
      knownLiveRunIds: new Set(),
      removedRunIds: new Set(),
    }),
    [missing],
  );
});

test("keeps concurrent live additions and newer live versions without retaining stale members", () => {
  const baseline = run("run-existing", "running", 3, 3);
  const completed = run("run-existing", "succeeded", 8, 8);
  const stale = run("run-stale", "succeeded", 5, 5);
  const concurrent = run("run-concurrent", "queued", 1, 9);

  assert.deepEqual(
    reconcileWorkflowRunBaseline({
      baseline: [baseline],
      live: [completed, stale, concurrent],
      knownLiveRunIds: new Set([baseline.id, stale.id]),
      removedRunIds: new Set(),
    }),
    [concurrent, completed],
  );
});

test("does not restore runs that were deleted while the baseline request was in flight", () => {
  const deleted = run("run-deleted", "succeeded", 8);

  assert.deepEqual(
    reconcileWorkflowRunBaseline({
      baseline: [deleted],
      live: [deleted],
      knownLiveRunIds: new Set([deleted.id]),
      removedRunIds: new Set([deleted.id]),
    }),
    [],
  );
});
