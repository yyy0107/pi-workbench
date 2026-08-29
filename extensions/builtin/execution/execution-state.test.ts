import assert from "node:assert/strict";
import test from "node:test";

import { workflowClient } from "@/runtime/pi/client/workflows/workflow-client";
import type { WorkflowSummary } from "@/runtime/shared/execution";

import { useWorkflowCatalogStore } from "./execution-state";

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
  const originalList = workflowClient.list;
  const originalListRuns = workflowClient.listRuns;
  workflowClient.list = async () => ({ items: [workflow] });
  workflowClient.listRuns = async () => {
    throw new Error("run-history-unavailable");
  };
  useWorkflowCatalogStore.setState({
    items: [],
    runs: [],
    removedRunIds: new Set(),
    loadState: "idle",
    error: undefined,
  });

  try {
    await useWorkflowCatalogStore.getState().refresh();

    const state = useWorkflowCatalogStore.getState();
    assert.equal(state.loadState, "ready");
    assert.deepEqual(state.items, [workflow]);
    assert.deepEqual(state.runs, []);
    assert.equal(state.error, undefined);
  } finally {
    workflowClient.list = originalList;
    workflowClient.listRuns = originalListRuns;
  }
});

test("publishes the catalog before supplementary snapshots finish", async () => {
  const originalList = workflowClient.list;
  const originalListRuns = workflowClient.listRuns;
  let resolveRuns: ((value: { items: [] }) => void) | undefined;
  workflowClient.list = async () => ({ items: [workflow] });
  workflowClient.listRuns = () =>
    new Promise((resolve) => {
      resolveRuns = resolve;
    });
  useWorkflowCatalogStore.setState({
    items: [],
    runs: [],
    removedRunIds: new Set(),
    loadState: "idle",
    error: undefined,
  });

  try {
    const refresh = useWorkflowCatalogStore.getState().refresh();
    await new Promise<void>((resolve) => setImmediate(resolve));

    const visibleState = useWorkflowCatalogStore.getState();
    assert.equal(visibleState.loadState, "ready");
    assert.deepEqual(visibleState.items, [workflow]);

    assert.ok(resolveRuns);
    resolveRuns({ items: [] });
    await refresh;
  } finally {
    workflowClient.list = originalList;
    workflowClient.listRuns = originalListRuns;
  }
});
