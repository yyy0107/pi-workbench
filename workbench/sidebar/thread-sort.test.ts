import assert from "node:assert/strict";
import test from "node:test";

import {
  moveThreadId,
  resolveManualThreadOrder,
  resolveThreadOrder,
  sortThreadIds,
} from "./thread-sort";

const threadIds = ["manual-first", "recent", "running", "active"];
const threadItems = [
  { id: "manual-first", lastMessageAt: new Date(100) },
  { id: "recent", lastMessageAt: new Date(400) },
  { id: "running", isRunning: true, lastMessageAt: new Date(200) },
  { id: "active", lastMessageAt: new Date(300) },
];

test("keeps the runtime order for manual sorting", () => {
  assert.equal(
    sortThreadIds({ threadIds, threadItems, mode: "manual", activeThreadId: "active" }),
    threadIds,
  );
});

test("sorts conversations from most to least recent", () => {
  assert.deepEqual(
    sortThreadIds({ threadIds, threadItems, mode: "recent", activeThreadId: "active" }),
    ["recent", "active", "running", "manual-first"],
  );
});

test("prioritizes running and active conversations before recency", () => {
  assert.deepEqual(
    sortThreadIds({ threadIds, threadItems, mode: "priority", activeThreadId: "active" }),
    ["running", "active", "recent", "manual-first"],
  );
});

test("reconciles stored manual order with added and removed conversations", () => {
  assert.deepEqual(
    resolveManualThreadOrder(["second", "new", "first"], ["removed", "first", "second"]),
    ["first", "second", "new"],
  );
});

test("moves a conversation before or after the drop target", () => {
  assert.deepEqual(moveThreadId(["a", "b", "c", "d"], "d", "b", "before"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveThreadId(["a", "b", "c", "d"], "a", "c", "after"), ["b", "c", "a", "d"]);
});

test("keeps a drag override until the selected automatic sort is reapplied", () => {
  assert.deepEqual(
    resolveThreadOrder({
      threadIds,
      threadItems,
      mode: "priority",
      activeThreadId: "active",
      storedManualOrder: ["recent", "manual-first", "running", "active"],
      storedManualOrderRevision: 3,
      sortRevision: 3,
    }),
    ["recent", "manual-first", "running", "active"],
  );
  assert.deepEqual(
    resolveThreadOrder({
      threadIds,
      threadItems,
      mode: "priority",
      activeThreadId: "active",
      storedManualOrder: ["recent", "manual-first", "running", "active"],
      storedManualOrderRevision: 3,
      sortRevision: 4,
    }),
    ["running", "active", "recent", "manual-first"],
  );
});
