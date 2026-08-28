import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkflowDocument } from "@/runtime/shared/execution";
import { compileExecutionDocument } from "./execution-compiler";
import { ExecutionError } from "./execution-errors";
import { ExecutionRepository } from "./execution-repository";

function document(): WorkflowDocument {
  return {
    schemaVersion: 1,
    id: "flow-1",
    kind: "workflow",
    scope: { type: "personal" },
    name: "Flow",
    graph: {
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "edge", source: "start", target: "end" }],
      editor: {},
    },
    concurrency: { mode: "queue" },
    triggers: [],
    draftRevision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("persists drafts atomically and rejects stale draft revisions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-repository-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const created = await repository.createDocument(document());
    const saved = await repository.saveDraft({ ...created, name: "Changed" }, 0);
    assert.equal(saved.name, "Changed");
    assert.equal(saved.draftRevision, 1);
    await assert.rejects(
      repository.saveDraft({ ...created, name: "Stale" }, 0),
      (error) => error instanceof ExecutionError && error.code === "workflow-conflict",
    );
    assert.equal((await repository.readDocument(created.id)).name, "Changed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pages append-only run events by monotonic sequence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-run-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const run = await repository.createRun({
      schemaVersion: 1,
      id: "run-1",
      workflowId: "flow-1",
      workflowName: "Flow",
      workflowKind: "workflow",
      revisionId: "revision-1",
      source: "manual",
      status: "queued",
      createdAt: 1,
      updatedAt: 1,
      lastSeq: 0,
      attempts: [],
    });
    await repository.updateRun(
      { ...run, status: "running" },
      { type: "run-status-changed", status: "running" },
    );
    const first = await repository.readRun(run.id, 0, 1);
    assert.deepEqual(
      first.events.map(({ seq }) => seq),
      [1],
    );
    assert.equal(first.nextSeq, 1);
    const second = await repository.readRun(run.id, first.nextSeq, 10);
    assert.deepEqual(
      second.events.map(({ seq }) => seq),
      [2],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletes a completed run directory without accepting path traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-run-delete-"));
  try {
    const repository = new ExecutionRepository({
      rootDirectory: root,
      listWorkspaces: async () => [],
    });
    const run = await repository.createRun({
      schemaVersion: 1,
      id: "run-delete-1",
      workflowId: "flow-1",
      workflowName: "Flow",
      workflowKind: "workflow",
      revisionId: "revision-1",
      source: "manual",
      status: "succeeded",
      createdAt: 1,
      completedAt: 2,
      updatedAt: 2,
      lastSeq: 0,
      attempts: [],
    });

    assert.equal((await repository.deleteRun(run.id)).id, run.id);
    await assert.rejects(
      repository.readRunSummary(run.id),
      (error) => error instanceof ExecutionError && error.code === "run-not-found",
    );
    await assert.rejects(repository.deleteRun("../definitions"), TypeError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects project publish after external content changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-project-"));
  const workspace = path.join(root, "workspace");
  try {
    const repository = new ExecutionRepository({
      rootDirectory: path.join(root, "data"),
      listWorkspaces: async () => [
        {
          workspaceId: "workspace-1",
          path: workspace,
          title: "Workspace",
          sessionIds: [],
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
    const created = await repository.createDocument({
      ...document(),
      scope: { type: "project", workspaceId: "workspace-1" },
    });
    const revision = compileExecutionDocument(created, 2).revision;
    const published = await repository.publish(created, revision, created.draftRevision);
    const definitionFile = path.join(workspace, ".pi", "workflows", `${created.id}.json`);
    const externallyEdited = JSON.parse(await readFile(definitionFile, "utf8")) as WorkflowDocument;
    await writeFile(
      definitionFile,
      `${JSON.stringify({ ...externallyEdited, name: "Edited outside Workbench" }, null, 2)}\n`,
    );

    await assert.rejects(
      repository.publish(
        published,
        compileExecutionDocument(published, 3).revision,
        published.draftRevision,
      ),
      (error) => error instanceof ExecutionError && error.code === "revision-conflict",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
