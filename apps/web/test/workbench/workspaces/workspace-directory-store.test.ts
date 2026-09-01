import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceDirectoryStoreInstallation } from "@/workbench/workspaces/workspace-directory-store";

test("stores only workspace UI ids and clears them without owning workspace entities", () => {
  const { store } = createWorkspaceDirectoryStoreInstallation();

  const initial = store.getState();
  assert.equal("directories" in initial, false);
  assert.equal("pinnedDirectoryIds" in initial, false);
  assert.equal("syncDirectories" in initial, false);

  initial.reconcileDirectoryIds(
    ["workspace-a", "workspace-b", "workspace-c"],
    ["workspace-b", "workspace-c"],
  );
  assert.equal(store.getState().activeDirectoryId, "workspace-a");
  assert.deepEqual(store.getState().collapsedDirectoryIds, ["workspace-b", "workspace-c"]);

  store.getState().beginNewThread("workspace-b");
  assert.deepEqual(
    {
      activeDirectoryId: store.getState().activeDirectoryId,
      draftDirectoryId: store.getState().draftDirectoryId,
    },
    { activeDirectoryId: "workspace-b", draftDirectoryId: "workspace-b" },
  );
  assert.deepEqual(store.getState().collapsedDirectoryIds, ["workspace-c"]);

  store.getState().toggleDirectory("workspace-c");
  assert.deepEqual(store.getState().collapsedDirectoryIds, []);

  store.getState().discardDirectory("workspace-b");
  assert.equal(store.getState().activeDirectoryId, undefined);
  assert.equal(store.getState().draftDirectoryId, undefined);
});

test("preserves an explicitly collapsed active workspace when only workspace order changes", () => {
  const { store } = createWorkspaceDirectoryStoreInstallation();
  store.setState({
    activeDirectoryId: "workspace-pinned",
    draftDirectoryId: undefined,
    collapsedDirectoryIds: ["workspace-pinned"],
  });
  store.getState().reconcileDirectoryIds(["workspace-b", "workspace-pinned", "workspace-a"], []);

  assert.equal(store.getState().activeDirectoryId, "workspace-pinned");
  assert.deepEqual(store.getState().collapsedDirectoryIds, ["workspace-pinned"]);
});

test("restores a workspace to an explicit collapsed or expanded state", () => {
  const { store } = createWorkspaceDirectoryStoreInstallation();
  store.setState({
    activeDirectoryId: "workspace-a",
    draftDirectoryId: undefined,
    collapsedDirectoryIds: ["workspace-b"],
  });
  store.getState().setDirectoryCollapsed("workspace-a", true);
  assert.deepEqual(store.getState().collapsedDirectoryIds, ["workspace-b", "workspace-a"]);

  store.getState().setDirectoryCollapsed("workspace-b", false);
  assert.deepEqual(store.getState().collapsedDirectoryIds, ["workspace-a"]);
});

test("isolates same-id workspace selection across application installations", () => {
  const first = createWorkspaceDirectoryStoreInstallation();
  const second = createWorkspaceDirectoryStoreInstallation();

  first.port.actions.reconcileDirectoryIds(["shared", "first-only"], []);
  second.port.actions.reconcileDirectoryIds(["shared", "second-only"], []);
  first.port.actions.beginNewThread("first-only");
  first.port.actions.setDirectoryCollapsed("shared", true);

  assert.deepEqual(
    {
      active: first.port.getSnapshot().activeDirectoryId,
      draft: first.port.getSnapshot().draftDirectoryId,
      collapsed: first.port.getSnapshot().collapsedDirectoryIds,
    },
    { active: "first-only", draft: "first-only", collapsed: ["shared"] },
  );
  assert.deepEqual(
    {
      active: second.port.getSnapshot().activeDirectoryId,
      draft: second.port.getSnapshot().draftDirectoryId,
      collapsed: second.port.getSnapshot().collapsedDirectoryIds,
    },
    { active: "shared", draft: undefined, collapsed: [] },
  );
  assert.notEqual(first.store, second.store);
  assert.notEqual(first.port, second.port);
});
