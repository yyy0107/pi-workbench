import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkflowDocument, WorkflowRunStatus } from "@/runtime/shared/execution";
import { compileExecutionDocument } from "./execution-compiler";
import { ExecutionEngine } from "./execution-engine";
import {
  ExecutionNodeExecutorRegistry,
  type ExecutionNodeExecutor,
} from "./execution-node-executor";
import { ExecutionRepository } from "./execution-repository";

function approvalDocument(): WorkflowDocument {
  return {
    schemaVersion: 1,
    id: "approval-flow",
    kind: "sop",
    scope: { type: "personal" },
    name: "Approval flow",
    graph: {
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "approval",
          type: "approval",
          name: "Approval",
          position: { x: 100, y: 0 },
          config: { message: "Approve?" },
        },
        { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: "a", source: "start", target: "approval" },
        { id: "b", source: "approval", target: "end" },
      ],
      editor: {},
    },
    concurrency: { mode: "queue" },
    triggers: [],
    draftRevision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function parallelDocument(): WorkflowDocument {
  return {
    ...approvalDocument(),
    id: "parallel-flow",
    kind: "workflow",
    name: "Parallel flow",
    graph: {
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "left",
          type: "agent",
          name: "Left",
          position: { x: 100, y: 0 },
          config: { prompt: "Left" },
        },
        {
          id: "right",
          type: "agent",
          name: "Right",
          position: { x: 100, y: 100 },
          config: { prompt: "Right" },
        },
        { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: "left-in", source: "start", target: "left" },
        { id: "right-in", source: "start", target: "right" },
        { id: "left-out", source: "left", target: "end" },
        { id: "right-out", source: "right", target: "end" },
      ],
      editor: {},
    },
  };
}

function legacyQueuedAutomationDocument(): WorkflowDocument {
  return {
    ...approvalDocument(),
    id: "legacy-queued-automation",
    kind: "automation",
    name: "Legacy queued automation",
  };
}

async function waitForStatus(
  repository: ExecutionRepository,
  runId: string,
  status: WorkflowRunStatus,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await repository.readRunSummary(runId)).status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Run ${runId} did not reach ${status}.`);
}

test("pauses an Approval node and resumes the same run after resolution", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-flow-engine-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const inert: ExecutionNodeExecutor = {
      async execute() {
        return {};
      },
    };
    const engine = new ExecutionEngine({
      repository,
      executors: new ExecutionNodeExecutorRegistry({ agent: inert, command: inert }),
    });
    const revision = compileExecutionDocument(approvalDocument(), 10).revision;
    const admission = await engine.start({ revision, source: "manual" });
    assert.notEqual(admission.kind, "skipped");
    if (admission.kind === "skipped") return;
    await waitForStatus(repository, admission.run.id, "waiting-for-approval");
    await engine.resolveApproval({
      runId: admission.run.id,
      nodeId: "approval",
      approved: true,
      result: { approvedBy: "test" },
    });
    await waitForStatus(repository, admission.run.id, "succeeded");
    const run = await repository.readRunSummary(admission.run.id);
    assert.equal(run.attempts.find(({ nodeId }) => nodeId === "approval")?.status, "succeeded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports running only after an execution slot is acquired and queued only when blocked", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-flow-engine-admission-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const inert: ExecutionNodeExecutor = {
      async execute() {
        return {};
      },
    };
    const changedStatuses: WorkflowRunStatus[] = [];
    const engine = new ExecutionEngine({
      repository,
      executors: new ExecutionNodeExecutorRegistry({ agent: inert, command: inert }),
      onRunChanged: (run) => changedStatuses.push(run.status),
    });
    const revision = compileExecutionDocument(approvalDocument(), 10).revision;

    const started = await engine.start({ revision, source: "manual" });
    assert.equal(started.kind, "started");
    if (started.kind !== "started") return;
    assert.equal(started.run.status, "running");
    assert.equal(typeof started.run.startedAt, "number");
    assert.equal(changedStatuses[0], "running");

    const queued = await engine.start({ revision, source: "manual" });
    assert.equal(queued.kind, "queued");
    assert.equal(queued.run.status, "queued");
    assert.equal(queued.run.startedAt, undefined);
    assert.equal(changedStatuses.at(-1), "queued");

    await engine.cancel(queued.run.id);
    await engine.cancel(started.run.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("starts every automation trigger independently, including legacy queued revisions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-automation-engine-admission-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const inert: ExecutionNodeExecutor = {
      async execute() {
        return {};
      },
    };
    const engine = new ExecutionEngine({
      repository,
      executors: new ExecutionNodeExecutorRegistry({ agent: inert, command: inert }),
    });
    const revision = compileExecutionDocument(legacyQueuedAutomationDocument(), 10).revision;
    const admissions = [];

    // This exceeds the generic engine pool limit and proves automations do not
    // enter either a per-task queue or the generic workflow execution queue.
    for (let index = 0; index < 9; index += 1) {
      admissions.push(await engine.start({ revision, source: "schedule" }));
    }

    assert.deepEqual(
      admissions.map(({ kind }) => kind),
      Array.from({ length: 9 }, () => "started"),
    );
    for (const admission of admissions) {
      assert.equal(admission.kind, "started");
      if (admission.kind !== "started") continue;
      assert.equal(admission.run.status, "running");
      await engine.cancel(admission.run.id);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records every settled parallel node before propagating a branch failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-flow-engine-parallel-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const executor: ExecutionNodeExecutor = {
      async execute({ node }) {
        if (node.id === "left") {
          const error = new Error("left failed");
          Object.assign(error, { code: "left-failed" });
          throw error;
        }
        return { output: { branch: node.id } };
      },
    };
    const engine = new ExecutionEngine({
      repository,
      executors: new ExecutionNodeExecutorRegistry({ agent: executor, command: executor }),
    });
    const admission = await engine.start({
      revision: compileExecutionDocument(parallelDocument(), 10).revision,
      source: "manual",
    });
    assert.notEqual(admission.kind, "skipped");
    if (admission.kind === "skipped") return;
    await waitForStatus(repository, admission.run.id, "failed");
    const run = await repository.readRunSummary(admission.run.id);
    assert.equal(run.attempts.find(({ nodeId }) => nodeId === "left")?.status, "failed");
    assert.equal(run.attempts.find(({ nodeId }) => nodeId === "right")?.status, "succeeded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails a run and aborts active nodes when its scheduled duration is exceeded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-flow-engine-timeout-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const executor: ExecutionNodeExecutor = {
      async execute({ signal }) {
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(signal.reason);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
        return {};
      },
    };
    const engine = new ExecutionEngine({
      repository,
      executors: new ExecutionNodeExecutorRegistry({ agent: executor, command: executor }),
    });
    const admission = await engine.start({
      revision: compileExecutionDocument(parallelDocument(), 10).revision,
      source: "schedule",
      maxRunDurationSeconds: 0.02,
    });
    assert.notEqual(admission.kind, "skipped");
    if (admission.kind === "skipped") return;

    await waitForStatus(repository, admission.run.id, "failed");
    const run = await repository.readRunSummary(admission.run.id);
    assert.equal(run.errorCode, "run-timed-out");
    assert.equal(run.errorMessage, "Run exceeded its maximum duration.");
    assert.deepEqual(
      run.attempts
        .filter(({ nodeId }) => nodeId === "left" || nodeId === "right")
        .map(({ status, errorCode }) => ({ status, errorCode })),
      [
        { status: "failed", errorCode: "run-timed-out" },
        { status: "failed", errorCode: "run-timed-out" },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
