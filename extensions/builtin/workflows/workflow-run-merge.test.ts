import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowRunSummary } from "@/runtime/shared/execution";
import { mergeWorkflowRuns } from "./workflow-run-merge";

function run(
  status: WorkflowRunSummary["status"],
  lastSeq: number,
  updatedAt = lastSeq,
): WorkflowRunSummary {
  return {
    schemaVersion: 1,
    id: "run-1",
    workflowId: "workflow-1",
    workflowName: "Daily review",
    workflowKind: "automation",
    revisionId: "revision-1",
    source: "manual",
    status,
    createdAt: 0,
    updatedAt,
    lastSeq,
    attempts: [],
  };
}

test("does not let a delayed queued admission overwrite a completed run", () => {
  const completed = run("succeeded", 8, 8);
  assert.deepEqual(mergeWorkflowRuns([completed], [run("queued", 1, 1)]), [completed]);
});

test("accepts a newer host snapshot and resolves same-sequence refresh races by updatedAt", () => {
  assert.equal(mergeWorkflowRuns([run("queued", 1)], [run("running", 2)])[0]?.status, "running");
  assert.equal(
    mergeWorkflowRuns([run("running", 2, 10)], [run("succeeded", 2, 11)])[0]?.status,
    "succeeded",
  );
});
