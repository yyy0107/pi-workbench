import assert from "node:assert/strict";
import test from "node:test";

import { indexVisibleThreads } from "./thread-list-index";

test("resolves scoped threads to canonical indexes without losing visible order", () => {
  assert.deepEqual(indexVisibleThreads(["a", "b", "c", "d"], ["d", "b"]), [
    { threadId: "d", index: 3 },
    { threadId: "b", index: 1 },
  ]);
});

test("ignores stale scoped ids", () => {
  assert.deepEqual(indexVisibleThreads(["a", "b"], ["missing", "a"]), [
    { threadId: "a", index: 0 },
  ]);
});
