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
