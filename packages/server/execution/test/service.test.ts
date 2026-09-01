import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkflowRunDeleteValue, WorkflowRunSummary } from "@workbench/execution-contracts";
import { ExecutionError } from "../src/errors";
import { ExecutionRepository } from "../src/repository";
import { ExecutionService } from "../src/service";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

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

test("holds concurrent RPCs behind one startup recovery", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-execution-service-initialize-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new ExecutionRepository({ rootDirectory: root });
  const recovery = deferred<WorkflowRunSummary[]>();
  const recoveryStarted = deferred<void>();
  let recoveryCalls = 0;
  repository.markInterruptedRuns = async () => {
    recoveryCalls += 1;
    recoveryStarted.resolve();
    return recovery.promise;
  };
  const service = new ExecutionService({
    repository,
    isWorkspaceTrusted: () => true,
  });

  let firstResolved = false;
  let secondResolved = false;
  const first = service.list({}).then((value) => {
    firstResolved = true;
    return value;
  });
  const second = service.list({}).then((value) => {
    secondResolved = true;
    return value;
  });
  await recoveryStarted.promise;
  await Promise.resolve();

  assert.equal(recoveryCalls, 1);
  assert.equal(firstResolved, false);
  assert.equal(secondResolved, false);

  recovery.resolve([]);
  assert.deepEqual(await Promise.all([first, second]), [{ items: [] }, { items: [] }]);
  assert.equal(recoveryCalls, 1);
});

test("retries startup recovery after a failed attempt", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-execution-service-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = new ExecutionRepository({ rootDirectory: root });
  let recoveryCalls = 0;
  repository.markInterruptedRuns = async () => {
    recoveryCalls += 1;
    if (recoveryCalls === 1) throw new Error("recovery unavailable");
    return [];
  };
  const service = new ExecutionService({
    repository,
    isWorkspaceTrusted: () => true,
  });

  await assert.rejects(service.list({}), /recovery unavailable/u);
  assert.equal(recoveryCalls, 1);
  assert.deepEqual(await service.list({}), { items: [] });
  assert.equal(recoveryCalls, 2);
});

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

test("returns the project-scoped workflow directory to the editor", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-execution-service-project-path-"));
  const workspace = path.join(root, "workspace");
  try {
    let catalogWorkspacePath: string | undefined;
    const repository = new ExecutionRepository({
      rootDirectory: path.join(root, "data"),
      listWorkspaces: async () => [{ workspaceId: "workspace-1", path: workspace }],
    });
    const service = new ExecutionService({
      repository,
      isWorkspaceTrusted: () => true,
      readAgentResourceCatalog: async ({ workspacePath }) => {
        catalogWorkspacePath = workspacePath;
        return {
          skills: [],
          extensions: [],
          catalogAvailable: true,
          projectResourcesTrusted: true,
        };
      },
    });

    const created = await service.create({
      kind: "workflow",
      scope: { type: "project", workspaceId: "workspace-1" },
      name: "Project workflow",
    });
    const expected = path.join(workspace, ".pi", "workflows", created.document.id);
    assert.equal(created.workflowDirectory, expected);
    assert.equal(
      (await service.read({ workflowId: created.document.id, workspaceId: "workspace-1" }))
        .workflowDirectory,
      expected,
    );
    const saved = await service.saveDraft({
      workflowId: created.document.id,
      baseDraftRevision: created.document.draftRevision,
      draft: {
        ...created.document,
        agents: [{ id: "reviewer", name: "Reviewer" }],
      },
    });
    await service.readAgentResources({
      workflowId: saved.document.id,
      agentId: "reviewer",
      promptTemplate: "default",
    });
    assert.equal(catalogWorkspacePath, path.join(expected, "agents", "reviewer"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
