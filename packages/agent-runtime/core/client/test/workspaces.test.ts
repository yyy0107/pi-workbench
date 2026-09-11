import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptCreatedWorkspaceAndBeginThread,
  addedWorkspaceIdsForReconciliation,
  resolveWorkspaceSelection,
} from "../src/workspace/selection";

test("skips workspace UI reconciliation when only the authoritative order changes", () => {
  assert.equal(
    addedWorkspaceIdsForReconciliation(
      ["workspace-pinned", "workspace-a", "workspace-b"],
      ["workspace-pinned", "workspace-b", "workspace-a"],
    ),
    undefined,
  );
});

test("reconciles workspace UI state when authoritative membership changes", () => {
  assert.deepEqual(addedWorkspaceIdsForReconciliation(undefined, ["workspace-a", "workspace-b"]), [
    "workspace-b",
  ]);
  assert.deepEqual(
    addedWorkspaceIdsForReconciliation(
      ["workspace-a", "workspace-b"],
      ["workspace-a", "workspace-c"],
    ),
    ["workspace-c"],
  );
  assert.deepEqual(
    addedWorkspaceIdsForReconciliation(["workspace-a", "workspace-b"], ["workspace-a"]),
    [],
  );
});

test("derives selected entities from the authoritative ordered workspace collection", () => {
  const workspaces = [
    { id: "workspace-a", name: "A", rootPath: "/a", pinned: true },
    { id: "workspace-b", name: "B", rootPath: "/b", pinned: false },
  ];
  const selection = resolveWorkspaceSelection(workspaces, {
    activeWorkspaceId: "workspace-b",
    draftWorkspaceId: "workspace-a",
    collapsedWorkspaceIds: ["workspace-a", "removed-workspace"],
  });

  assert.equal(selection.workspaces, workspaces);
  assert.equal(selection.activeWorkspace, workspaces[1]);
  assert.equal(selection.draftWorkspace, workspaces[0]);
  assert.deepEqual(selection.collapsedWorkspaceIds, ["workspace-a"]);
});

test("does not manufacture workspace entities for stale UI ids", () => {
  const selection = resolveWorkspaceSelection(
    [{ id: "workspace-a", name: "A", rootPath: "/a", pinned: true }],
    {
      activeWorkspaceId: "removed-workspace",
      draftWorkspaceId: "removed-workspace",
      collapsedWorkspaceIds: ["removed-workspace"],
    },
  );

  assert.equal(selection.activeWorkspaceId, undefined);
  assert.equal(selection.activeWorkspace, undefined);
  assert.equal(selection.draftWorkspaceId, undefined);
  assert.equal(selection.draftWorkspace, undefined);
  assert.deepEqual(selection.collapsedWorkspaceIds, []);
});

test("accepts a create result before selecting its draft and treats refresh as best effort", async () => {
  const workspace = {
    id: "workspace-created",
    name: "Created",
    rootPath: "/created",
  };
  const refreshFailure = new Error("refresh failed");
  const events: string[] = [];
  let reportRefreshError!: (error: unknown) => void;
  const refreshErrorReported = new Promise<unknown>((resolve) => {
    reportRefreshError = resolve;
  });

  const result = acceptCreatedWorkspaceAndBeginThread(workspace, {
    acceptWorkspace: (accepted) => events.push(`accept:${accepted.id}`),
    beginNewThread: (workspaceId) => events.push(`begin:${workspaceId}`),
    refreshWorkspaces: async () => {
      events.push("refresh");
      throw refreshFailure;
    },
    onRefreshError: reportRefreshError,
  });

  assert.equal(result, undefined);
  assert.deepEqual(events, ["accept:workspace-created", "begin:workspace-created", "refresh"]);
  assert.equal(await refreshErrorReported, refreshFailure);
});
