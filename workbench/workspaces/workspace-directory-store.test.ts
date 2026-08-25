import assert from "node:assert/strict";
import test from "node:test";

import { useWorkspaceDirectoryStore } from "./workspace-directory-store";

test("stores only workspace UI ids and clears them without owning workspace entities", (t) => {
  useWorkspaceDirectoryStore.setState({
    activeDirectoryId: undefined,
    draftDirectoryId: undefined,
    collapsedDirectoryIds: [],
  });
  t.after(() => {
    useWorkspaceDirectoryStore.setState({
      activeDirectoryId: undefined,
      draftDirectoryId: undefined,
      collapsedDirectoryIds: [],
    });
  });

  const initial = useWorkspaceDirectoryStore.getState();
  assert.equal("directories" in initial, false);
  assert.equal("pinnedDirectoryIds" in initial, false);
  assert.equal("syncDirectories" in initial, false);

  initial.reconcileDirectoryIds(
    ["workspace-a", "workspace-b", "workspace-c"],
    ["workspace-b", "workspace-c"],
  );
  assert.equal(useWorkspaceDirectoryStore.getState().activeDirectoryId, "workspace-a");
  assert.deepEqual(useWorkspaceDirectoryStore.getState().collapsedDirectoryIds, [
    "workspace-b",
    "workspace-c",
  ]);

  useWorkspaceDirectoryStore.getState().beginNewThread("workspace-b");
  assert.deepEqual(
    {
      activeDirectoryId: useWorkspaceDirectoryStore.getState().activeDirectoryId,
      draftDirectoryId: useWorkspaceDirectoryStore.getState().draftDirectoryId,
    },
    { activeDirectoryId: "workspace-b", draftDirectoryId: "workspace-b" },
  );
  assert.deepEqual(useWorkspaceDirectoryStore.getState().collapsedDirectoryIds, ["workspace-c"]);

  useWorkspaceDirectoryStore.getState().toggleDirectory("workspace-c");
  assert.deepEqual(useWorkspaceDirectoryStore.getState().collapsedDirectoryIds, []);

  useWorkspaceDirectoryStore.getState().discardDirectory("workspace-b");
  assert.equal(useWorkspaceDirectoryStore.getState().activeDirectoryId, undefined);
  assert.equal(useWorkspaceDirectoryStore.getState().draftDirectoryId, undefined);
});

test("preserves an explicitly collapsed active workspace when only workspace order changes", (t) => {
  useWorkspaceDirectoryStore.setState({
    activeDirectoryId: "workspace-pinned",
    draftDirectoryId: undefined,
    collapsedDirectoryIds: ["workspace-pinned"],
  });
  t.after(() => {
    useWorkspaceDirectoryStore.setState({
      activeDirectoryId: undefined,
      draftDirectoryId: undefined,
      collapsedDirectoryIds: [],
    });
  });

  useWorkspaceDirectoryStore
    .getState()
    .reconcileDirectoryIds(["workspace-b", "workspace-pinned", "workspace-a"], []);

  assert.equal(useWorkspaceDirectoryStore.getState().activeDirectoryId, "workspace-pinned");
  assert.deepEqual(useWorkspaceDirectoryStore.getState().collapsedDirectoryIds, [
    "workspace-pinned",
  ]);
});

test("restores a workspace to an explicit collapsed or expanded state", (t) => {
  useWorkspaceDirectoryStore.setState({
    activeDirectoryId: "workspace-a",
    draftDirectoryId: undefined,
    collapsedDirectoryIds: ["workspace-b"],
  });
  t.after(() => {
    useWorkspaceDirectoryStore.setState({
      activeDirectoryId: undefined,
      draftDirectoryId: undefined,
      collapsedDirectoryIds: [],
    });
  });

  useWorkspaceDirectoryStore.getState().setDirectoryCollapsed("workspace-a", true);
  assert.deepEqual(useWorkspaceDirectoryStore.getState().collapsedDirectoryIds, [
    "workspace-b",
    "workspace-a",
  ]);

  useWorkspaceDirectoryStore.getState().setDirectoryCollapsed("workspace-b", false);
  assert.deepEqual(useWorkspaceDirectoryStore.getState().collapsedDirectoryIds, ["workspace-a"]);
});
