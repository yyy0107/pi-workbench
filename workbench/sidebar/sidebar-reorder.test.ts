import assert from "node:assert/strict";
import test from "node:test";

import { moveSidebarItemId, sidebarItemIdAfterMove } from "./sidebar-reorder";

test("moves a sidebar item before or after the target", () => {
  assert.deepEqual(moveSidebarItemId(["a", "b", "c", "d"], "d", "b", "before"), [
    "a",
    "d",
    "b",
    "c",
  ]);
  assert.deepEqual(moveSidebarItemId(["a", "b", "c", "d"], "a", "c", "after"), [
    "b",
    "c",
    "a",
    "d",
  ]);
});

test("resolves the next visible item for a persisted insert-before move", () => {
  assert.equal(sidebarItemIdAfterMove(["a", "b", "c"], "c", "a", "before"), "a");
  assert.equal(sidebarItemIdAfterMove(["a", "b", "c"], "a", "b", "after"), "c");
  assert.equal(sidebarItemIdAfterMove(["a", "b", "c"], "a", "c", "after"), undefined);
});
