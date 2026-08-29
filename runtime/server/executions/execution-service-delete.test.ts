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
