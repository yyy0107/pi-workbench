import assert from "node:assert/strict";
import test from "node:test";

import { PiClientManagerCatalogState } from "../../src/runtime/manager-catalog";

test("manager catalog state clears all directory projections and invalidates requests together", () => {
  const catalog = new PiClientManagerCatalogState();
  catalog.archived.add("session-a");
  catalog.pinned.add("session-a");
  catalog.pinnedWorkspaces.add("workspace-a");
  catalog.generation = 7;

  catalog.dispose();

  assert.equal(catalog.archived.size, 0);
  assert.equal(catalog.pinned.size, 0);
  assert.equal(catalog.pinnedWorkspaces.size, 0);
  assert.equal(catalog.generation, 8);
});

test("catalog owner reports meaningful pin/archive deltas and preserves omitted workspace order", () => {
  const catalog = new PiClientManagerCatalogState();
  const workspace = (workspaceId: string) => ({
    workspaceId,
    title: workspaceId,
    path: `/${workspaceId}`,
    sessionIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  catalog.applyWorkspaceSnapshot([workspace("a"), workspace("b"), workspace("c")], [], [], []);
  assert.equal(catalog.reorderWorkspaces(["b", "a"]), true);
  assert.deepEqual([...catalog.workspaces.keys()], ["b", "a", "c"]);
  assert.equal(catalog.reorderWorkspaces(["b", "a", "c"]), false);
  assert.equal(catalog.setSessionPinned("s", true), true);
  assert.equal(catalog.setSessionPinned("s", true), false);
  assert.equal(catalog.setSessionArchived("s", true), true);
  assert.equal(catalog.setSessionArchived("s", true), false);
});
