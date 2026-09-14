import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchWorkspaceGitChangedFile } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { exceedsReviewRenderBudget, reviewFileWindow } from "../lib/review-file-window";

const files = (count: number): WorkbenchWorkspaceGitChangedFile[] =>
  Array.from({ length: count }, (_, index) => ({ path: `file-${index}.ts`, kind: "modified" }));

test("file count, line count, and pagination do not trigger single-file mode", () => {
  for (const count of [0, 1, 19, 20, 200]) {
    const input = files(count).map((file) => ({ ...file, additions: 10_000, deletions: 10_000 }));
    for (const nextOffset of [undefined, 200]) {
      const window = reviewFileWindow(input, nextOffset, 0, false);
      assert.equal(window.singleFile, false);
      assert.equal(window.visibleFiles, input);
      assert.equal(window.hasPrevious, false);
    }
  }
  assert.equal(reviewFileWindow([], undefined, 0, false).hasNext, false);
});

test("only finite render durations at or above the budget trigger fallback", () => {
  for (const duration of [-1, 0, 16, 99.99, NaN, Infinity]) {
    assert.equal(exceedsReviewRenderBudget(duration), false);
  }
  for (const duration of [100, 101, 2_000]) {
    assert.equal(exceedsReviewRenderBudget(duration), true);
  }
});

test("a slow render switches even a small diff to its selected file", () => {
  const input = files(2);
  const window = reviewFileWindow(input, undefined, 1, exceedsReviewRenderBudget(100));
  assert.equal(window.singleFile, true);
  assert.deepEqual(window.visibleFiles, [input[1]]);
  assert.equal(reviewFileWindow([], undefined, 0, true).singleFile, false);
});

test("first and last file navigation is bounded", () => {
  const input = files(20);
  const first = reviewFileWindow(input, undefined, -1, true);
  assert.equal(first.index, 0);
  assert.equal(first.hasPrevious, false);
  assert.equal(first.hasNext, true);
  const last = reviewFileWindow(input, undefined, 100, true);
  assert.equal(last.index, 19);
  assert.deepEqual(last.visibleFiles, [input[19]]);
  assert.equal(last.hasNext, false);
});

test("pagination keeps the current file until the requested next file arrives", () => {
  const firstPage = files(20);
  const last = reviewFileWindow(firstPage, 20, 19, true);
  assert.equal(last.hasNext, true);
  assert.equal(last.nextNeedsPage, true);
  const pending = reviewFileWindow(firstPage, 20, 20, true);
  assert.equal(pending.waitingForPage, true);
  assert.deepEqual(pending.visibleFiles, [firstPage[19]]);
  const nextPage = files(25);
  const loaded = reviewFileWindow(nextPage, undefined, 20, true);
  assert.equal(loaded.waitingForPage, false);
  assert.deepEqual(loaded.visibleFiles, [nextPage[20]]);
  assert.equal(loaded.nextNeedsPage, false);
  assert.deepEqual(reviewFileWindow(nextPage, undefined, 18, true).visibleFiles, [nextPage[18]]);
});
