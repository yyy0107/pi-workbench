import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceGitCommit } from "@workbench/agent-runtime-pi-protocol/rpc";

import { createGitGraphLayout } from "./git-graph-layout";

function commit(hash: string, parentHashes: string[]): WorkspaceGitCommit {
  return {
    hash,
    shortHash: hash,
    parentHashes,
    authorName: "Ada",
    authoredAt: "2026-08-28T10:00:00-07:00",
    subject: hash,
    refs: [],
  };
}

test("keeps a linear history on one stable lane", () => {
  const layout = createGitGraphLayout([
    commit("c3", ["c2"]),
    commit("c2", ["c1"]),
    commit("c1", []),
  ]);

  assert.equal(layout.maxLaneCount, 1);
  assert.deepEqual(
    layout.rows.map((row) => ({ lane: row.lane, color: row.colorIndex })),
    [
      { lane: 0, color: 0 },
      { lane: 0, color: 0 },
      { lane: 0, color: 0 },
    ],
  );
});

test("opens and rejoins lanes around a merge commit", () => {
  const layout = createGitGraphLayout([
    commit("merge", ["main", "feature"]),
    commit("main", ["base"]),
    commit("feature", ["base"]),
    commit("base", []),
  ]);

  assert.equal(layout.maxLaneCount, 2);
  assert.deepEqual(
    layout.rows[0]?.parentSegments.map((segment) => [segment.fromLane, segment.toLane]),
    [
      [0, 0],
      [0, 1],
    ],
  );
  assert.equal(layout.rows[1]?.throughSegments[0]?.fromLane, 1);
  assert.equal(layout.rows[2]?.parentSegments[0]?.toLane, 0);
  assert.equal(layout.rows[3]?.lane, 0);
});

test("introduces an unrelated ref without discarding unresolved lanes", () => {
  const layout = createGitGraphLayout([
    commit("head-a", ["parent-a"]),
    commit("head-b", ["parent-b"]),
    commit("parent-b", []),
    commit("parent-a", []),
  ]);

  assert.equal(layout.rows[1]?.introduced, true);
  assert.equal(layout.rows[1]?.lane, 1);
  assert.equal(layout.maxLaneCount, 2);
  assert.deepEqual(layout.rows[1]?.throughSegments, [{ fromLane: 0, toLane: 0, colorIndex: 0 }]);
});
