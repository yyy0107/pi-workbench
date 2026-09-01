import assert from "node:assert/strict";
import test from "node:test";

import type { PiWorkflowClient } from "@workbench/agent-runtime-pi-client/execution";
import type { WorkflowReadValue, WorkflowSummary } from "@workbench/execution-contracts";

import { createWorkflowCatalogStore, createWorkflowEditorStore } from "./execution-state";

const workflow = {
  id: "workflow-1",
  kind: "workflow",
  scope: { type: "personal" },
  name: "Daily workflow",
  draftRevision: 1,
  createdAt: 1,
  updatedAt: 2,
} satisfies WorkflowSummary;

test("keeps the workflow catalog usable when run history is unavailable", async () => {
  const store = createWorkflowCatalogStore();
  const client = {
    list: async () => ({ items: [workflow] }),
    listRuns: async () => {
      throw new Error("run-history-unavailable");
    },
  } as unknown as PiWorkflowClient;
  store.setState({
    items: [],
    runs: [],
    removedRunIds: new Set(),
    loadState: "idle",
    error: undefined,
  });

  {
    await store.getState().refresh(client);

    const state = store.getState();
    assert.equal(state.loadState, "ready");
    assert.deepEqual(state.items, [workflow]);
    assert.deepEqual(state.runs, []);
    assert.equal(state.error, undefined);
  }
});

test("publishes the catalog before supplementary snapshots finish", async () => {
  const store = createWorkflowCatalogStore();
  let resolveRuns: ((value: { items: [] }) => void) | undefined;
  const client = {
    list: async () => ({ items: [workflow] }),
    listRuns: () =>
      new Promise((resolve) => {
        resolveRuns = resolve;
      }),
  } as unknown as PiWorkflowClient;
  store.setState({
    items: [],
    runs: [],
    removedRunIds: new Set(),
    loadState: "idle",
    error: undefined,
  });

  {
    const refresh = store.getState().refresh(client);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const visibleState = store.getState();
    assert.equal(visibleState.loadState, "ready");
    assert.deepEqual(visibleState.items, [workflow]);

    assert.ok(resolveRuns);
    resolveRuns({ items: [] });
    await refresh;
  }
});

test("retains the canonical workflow directory for Agent workspace presentation", () => {
  const value = {
    workflowDirectory: "/workbench/workflows/workflow-1",
    document: {
      schemaVersion: 3,
      id: "workflow-1",
      kind: "workflow",
      scope: { type: "personal" },
      name: "Daily workflow",
      agents: [],
      graph: {
        nodes: [
          { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
          { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
        ],
        edges: [{ id: "start-end", source: "start", target: "end" }],
        editor: {},
      },
      concurrency: { mode: "queue" },
      draftRevision: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  } satisfies WorkflowReadValue;

  const store = createWorkflowEditorStore();
  store.getState().load(value);
  assert.equal(store.getState().workflowDirectory, value.workflowDirectory);
  store.getState().reset();
});

test("keeps independently mounted workflow stores and clients isolated", async () => {
  const firstStore = createWorkflowCatalogStore();
  const secondStore = createWorkflowCatalogStore();
  const requestedBy: string[] = [];
  const firstClient = {
    list: async () => {
      requestedBy.push("first");
      return { items: [{ ...workflow, id: "workflow-first" }] };
    },
    listRuns: async () => ({ items: [] }),
  } as unknown as PiWorkflowClient;
  const secondClient = {
    list: async () => {
      requestedBy.push("second");
      return { items: [{ ...workflow, id: "workflow-second" }] };
    },
    listRuns: async () => ({ items: [] }),
  } as unknown as PiWorkflowClient;

  await Promise.all([
    firstStore.getState().refresh(firstClient),
    secondStore.getState().refresh(secondClient),
  ]);

  assert.deepEqual(requestedBy.sort(), ["first", "second"]);
  assert.deepEqual(
    firstStore.getState().items.map(({ id }) => id),
    ["workflow-first"],
  );
  assert.deepEqual(
    secondStore.getState().items.map(({ id }) => id),
    ["workflow-second"],
  );
});
