import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkflowDocument } from "@/runtime/shared/execution";
import {
  compileExecutionDocument,
  legacyExecutionRevisionIdForDocument,
} from "./execution-compiler";
import { ExecutionError } from "./execution-errors";
import { ExecutionRepository } from "./execution-repository";

function document(): WorkflowDocument {
  return {
    schemaVersion: 3,
    id: "flow-1",
    kind: "workflow",
    scope: { type: "personal" },
    name: "Flow",
    agents: [],
    graph: {
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "edge", source: "start", target: "end" }],
      editor: {},
    },
    concurrency: { mode: "queue" },
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

test("migrates v1 Agent nodes into stable Pi-native Agent workspaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-migration-"));
  try {
    const legacy = {
      schemaVersion: 1,
      id: "legacy-flow",
      kind: "workflow",
      scope: { type: "personal" },
      name: "Legacy flow",
      graph: {
        nodes: [
          { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
          {
            id: "review",
            type: "agent",
            name: "Reviewer",
            position: { x: 100, y: 0 },
            config: {
              prompt: "Review changes",
              model: { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" },
            },
          },
          { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
        ],
        edges: [
          { id: "a", source: "start", target: "review" },
          { id: "b", source: "review", target: "end" },
        ],
        editor: {},
      },
      concurrency: { mode: "queue" },
      triggers: [],
      draftRevision: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    await mkdir(path.join(root, "drafts"), { recursive: true });
    await writeFile(path.join(root, "drafts", "legacy-flow.json"), JSON.stringify(legacy));
    const repository = new ExecutionRepository({ rootDirectory: root });

    const migrated = await repository.readDocument("legacy-flow");
    assert.equal(migrated.schemaVersion, 3);
    assert.equal("triggers" in migrated, false);
    assert.deepEqual(migrated.agents, [{ id: "review-1", name: "Reviewer" }]);
    const migratedAgent = migrated.graph.nodes.find(({ type }) => type === "agent");
    assert.ok(migratedAgent?.type === "agent");
    assert.equal(migratedAgent.config.agentId, "review-1");
    assert.equal(
      await readFile(
        path.join(
          root,
          "workflows",
          "legacy-flow",
          "agents",
          "review-1",
          ".pi",
          "prompts",
          "default.md",
        ),
        "utf8",
      ),
      "Review changes\n",
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(root, "workflows", "legacy-flow", "agents", "review-1", ".pi", "settings.json"),
          "utf8",
        ),
      ),
      { defaultProvider: "openai", defaultModel: "gpt-5", defaultThinkingLevel: "high" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads and updates Agent prompts and model settings as Pi-native resources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-agent-resources-"));
  try {
    const repository = new ExecutionRepository({ rootDirectory: root });
    await repository.createDocument({
      ...document(),
      agents: [{ id: "reviewer", name: "Reviewer" }],
      graph: {
        nodes: [
          { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
          {
            id: "review",
            type: "agent",
            name: "Review",
            position: { x: 100, y: 0 },
            config: {
              agentId: "reviewer",
              promptTemplate: "default",
              output: { schema: { type: "object" } },
            },
          },
          { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
        ],
        edges: [
          { id: "a", source: "start", target: "review" },
          { id: "b", source: "review", target: "end" },
        ],
        editor: {},
      },
    });
    const settingsFile = path.join(
      root,
      "workflows",
      "flow-1",
      "agents",
      "reviewer",
      ".pi",
      "settings.json",
    );
    await writeFile(settingsFile, JSON.stringify({ theme: "dark" }));
    const updated = await repository.updateAgentResources({
      workflowId: "flow-1",
      agentId: "reviewer",
      promptTemplate: "default",
      prompt: "Check correctness and risks.",
      model: { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" },
    });

    assert.equal(updated.prompt, "Check correctness and risks.\n");
    assert.deepEqual(updated.model, {
      provider: "openai",
      modelId: "gpt-5",
      thinkingLevel: "high",
    });
    assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), {
      theme: "dark",
      defaultProvider: "openai",
      defaultModel: "gpt-5",
      defaultThinkingLevel: "high",
    });
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
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(root, "workflows", "flow-1", "runs", "run-1", "summary.json"),
          "utf8",
        ),
      ).id,
      "run-1",
    );
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

test("stores project workflow drafts, Agent resources, revisions, and runs in the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-project-storage-"));
  const data = path.join(root, "data");
  const workspace = path.join(root, "workspace");
  try {
    const repository = new ExecutionRepository({
      rootDirectory: data,
      listWorkspaces: async () => [{ workspaceId: "workspace-1", path: workspace }],
    });
    const created = await repository.createDocument({
      ...document(),
      scope: { type: "project", workspaceId: "workspace-1" },
      agents: [{ id: "reviewer", name: "Reviewer" }],
    });
    const workflowDirectory = path.join(workspace, ".pi", "workflows", created.id);

    assert.equal(await repository.workflowDirectory(created), workflowDirectory);
    assert.equal(
      await repository.agentWorkspaceDirectory(created, "reviewer"),
      path.join(workflowDirectory, "agents", "reviewer"),
    );
    assert.equal(
      JSON.parse(await readFile(path.join(workflowDirectory, "workflow.json"), "utf8")).id,
      created.id,
    );
    assert.equal(
      await readFile(
        path.join(workflowDirectory, "agents", "reviewer", ".pi", "prompts", "default.md"),
        "utf8",
      ),
      "Complete the supplied workflow step and submit its structured result.\n",
    );
    await assert.rejects(
      readFile(path.join(data, "workflows", created.id, "workflow.json"), "utf8"),
      (error) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT",
    );

    const revision = compileExecutionDocument(created, 2).revision;
    await repository.publish(created, revision, created.draftRevision);
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(workflowDirectory, "revisions", `${revision.revisionId}.json`),
          "utf8",
        ),
      ).revisionId,
      revision.revisionId,
    );
    assert.equal(
      JSON.parse(
        await readFile(path.join(workspace, ".pi", "workflows", `${created.id}.json`), "utf8"),
      ).id,
      created.id,
    );

    const run = await repository.createRun({
      schemaVersion: 1,
      id: "project-run-1",
      workflowId: created.id,
      workflowName: created.name,
      workflowKind: created.kind,
      revisionId: revision.revisionId,
      source: "manual",
      status: "queued",
      createdAt: 2,
      updatedAt: 2,
      lastSeq: 0,
      attempts: [],
    });
    assert.equal(
      JSON.parse(
        await readFile(path.join(workflowDirectory, "runs", run.id, "summary.json"), "utf8"),
      ).id,
      run.id,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migrates an existing project workflow out of the user execution directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-project-migration-"));
  const data = path.join(root, "data");
  const workspace = path.join(root, "workspace");
  const source = path.join(data, "workflows", "flow-1");
  const destination = path.join(workspace, ".pi", "workflows", "flow-1");
  try {
    const projectDocument: WorkflowDocument = {
      ...document(),
      scope: { type: "project", workspaceId: "workspace-1" },
      agents: [{ id: "reviewer", name: "Reviewer" }],
    };
    await mkdir(path.join(source, "agents", "reviewer", ".pi", "prompts"), {
      recursive: true,
    });
    await mkdir(path.join(source, "revisions"), { recursive: true });
    await mkdir(path.join(source, "runs", "run-1", "sessions", "reviewer"), {
      recursive: true,
    });
    await mkdir(path.join(source, "runs", "run-1", "artifacts"), { recursive: true });
    await writeFile(path.join(source, "workflow.json"), JSON.stringify(projectDocument));
    await writeFile(
      path.join(source, "agents", "reviewer", ".pi", "prompts", "default.md"),
      "Keep this customized prompt.\n",
    );
    await writeFile(path.join(source, "revisions", "revision-1.json"), '{"preserved":true}\n');
    await writeFile(
      path.join(source, "runs", "run-1", "sessions", "reviewer", "session.jsonl"),
      '{"preserved":true}\n',
    );
    await writeFile(path.join(source, "runs", "run-1", "artifacts", "result.txt"), "preserved\n");

    const repository = new ExecutionRepository({
      rootDirectory: data,
      listWorkspaces: async () => [{ workspaceId: "workspace-1", path: workspace }],
    });
    const migrated = await repository.readDocument(projectDocument.id);

    assert.equal(migrated.scope.type, "project");
    assert.equal(await repository.workflowDirectory(migrated), destination);
    assert.equal(
      await readFile(
        path.join(destination, "agents", "reviewer", ".pi", "prompts", "default.md"),
        "utf8",
      ),
      "Keep this customized prompt.\n",
    );
    assert.equal(
      await readFile(path.join(destination, "revisions", "revision-1.json"), "utf8"),
      '{"preserved":true}\n',
    );
    assert.equal(
      await readFile(
        path.join(destination, "runs", "run-1", "sessions", "reviewer", "session.jsonl"),
        "utf8",
      ),
      '{"preserved":true}\n',
    );
    assert.equal(
      await readFile(path.join(destination, "runs", "run-1", "artifacts", "result.txt"), "utf8"),
      "preserved\n",
    );
    await assert.rejects(
      readFile(path.join(source, "workflow.json"), "utf8"),
      (error) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes a migrated v2 project definition without reporting a false conflict", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workflow-v2-project-"));
  const data = path.join(root, "data");
  const workspace = path.join(root, "workspace");
  try {
    const repository = new ExecutionRepository({
      rootDirectory: data,
      listWorkspaces: async () => [{ workspaceId: "workspace-1", path: workspace }],
    });
    const created = await repository.createDocument({
      ...document(),
      scope: { type: "project", workspaceId: "workspace-1" },
    });
    const triggers = [
      {
        id: "weekday-morning",
        type: "schedule",
        name: "Weekday morning",
        cron: "0 9 * * 1-5",
        timezone: "America/Los_Angeles",
      },
    ];
    const legacyRevisionId = legacyExecutionRevisionIdForDocument(created, triggers);
    const legacyDocument = {
      ...created,
      schemaVersion: 2,
      triggers,
      publishedRevisionId: legacyRevisionId,
    };
    const definitionFile = path.join(workspace, ".pi", "workflows", `${created.id}.json`);
    const draftFile = path.join(workspace, ".pi", "workflows", created.id, "workflow.json");
    await mkdir(path.dirname(definitionFile), { recursive: true });
    await writeFile(definitionFile, JSON.stringify(legacyDocument));
    await writeFile(draftFile, JSON.stringify(legacyDocument));

    const migrated = await repository.readDocument(created.id);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal("triggers" in migrated, false);
    const published = await repository.publish(
      migrated,
      compileExecutionDocument(migrated, 3).revision,
      migrated.draftRevision,
    );
    assert.equal(published.schemaVersion, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
