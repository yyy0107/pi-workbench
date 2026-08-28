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
