import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkflowRunDeleteValue, WorkflowRunSummary } from "@/runtime/shared/execution";
import { ExecutionError } from "./execution-errors";
import { ExecutionRepository } from "./execution-repository";
import { ExecutionService } from "./execution-service";

function run(id: string, status: WorkflowRunSummary["status"]): WorkflowRunSummary {
  return {
    schemaVersion: 1,
    id,
    workflowId: "flow-1",
    workflowName: "Flow",
    workflowKind: "workflow",
    revisionId: "revision-1",
    source: "manual",
    status,
    createdAt: 1,
    ...(status === "succeeded" ? { completedAt: 2 } : {}),
    updatedAt: 2,
    lastSeq: 0,
    attempts: [],
  };
}

test("deletes terminal runs, publishes removal, and rejects active runs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-execution-service-delete-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const removed: WorkflowRunDeleteValue[] = [];
    const service = new ExecutionService({
      repository,
      isWorkspaceTrusted: () => true,
      onRunRemoved: (value) => removed.push(value),
    });
    await service.initialize();

    const active = await repository.createRun(run("run-active-1", "running"));
    await assert.rejects(
      service.deleteRun({ runId: active.id }),
      (error) => error instanceof ExecutionError && error.code === "run-active",
    );

    const completed = await repository.createRun(run("run-complete-1", "succeeded"));
    const deleted = await service.deleteRun({ runId: completed.id });
    assert.deepEqual(deleted, {
      deleted: true,
      runId: completed.id,
      workflowId: completed.workflowId,
    });
    assert.deepEqual(removed, [deleted]);
    await assert.rejects(
      repository.readRunSummary(completed.id),
      (error) => error instanceof ExecutionError && error.code === "run-not-found",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
