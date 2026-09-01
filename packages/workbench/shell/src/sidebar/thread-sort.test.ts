import assert from "node:assert/strict";
import test from "node:test";

import { moveThreadId, resolveThreadOrder, sortThreadIdsByCreation } from "./thread-sort";

const threadIds = ["older-active", "newest", "middle"];
const createdAtByThreadId = new Map([
  ["older-active", "2026-01-01T00:00:00.000Z"],
  ["newest", "2026-03-01T00:00:00.000Z"],
  ["middle", "2026-02-01T00:00:00.000Z"],
]);

test("sorts conversations by creation time instead of runtime activity order", () => {
  assert.deepEqual(sortThreadIdsByCreation(threadIds, createdAtByThreadId), [
    "newest",
    "middle",
    "older-active",
  ]);
});

test("uses the dragged id order after the canonical creation order", () => {
  assert.deepEqual(resolveThreadOrder(threadIds, createdAtByThreadId, ["middle", "older-active"]), [
    "newest",
    "middle",
    "older-active",
  ]);
});

test("reconciles the dragged id order with removed conversations", () => {
  assert.deepEqual(
    resolveThreadOrder(threadIds, createdAtByThreadId, [
      "removed",
      "older-active",
      "middle",
      "newest",
    ]),
    ["older-active", "middle", "newest"],
  );
});

test("moves a conversation before or after the drop target", () => {
  assert.deepEqual(moveThreadId(["a", "b", "c", "d"], "d", "b", "before"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveThreadId(["a", "b", "c", "d"], "a", "c", "after"), ["b", "c", "a", "d"]);
});
