import assert from "node:assert/strict";
import test from "node:test";

import { diffContextRanges, visiblePatchHunks } from "./unified-patch";

const context = (text: string) => ({ kind: "context" as const, text });
const added = (text: string) => ({ kind: "added" as const, text });

test("keeps one context line around each change and counts hidden lines", () => {
  const ranges = diffContextRanges([
    context("one"),
    context("two"),
    context("three"),
    added("four"),
    context("five"),
    context("six"),
  ]);

  assert.deepEqual(ranges, [{ start: 2, end: 5, hiddenBefore: 2, hiddenAfter: 1 }]);
});

test("combines omitted context between parsed hunks", () => {
  const hunks = visiblePatchHunks([
    {
      oldStart: 1,
      newStart: 1,
      lines: [context("one"), added("two"), context("three"), context("four")],
    },
    {
      oldStart: 7,
      newStart: 8,
      lines: [context("seven"), added("eight"), context("nine")],
    },
  ]);

  assert.equal(hunks.length, 2);
  assert.equal(hunks[0]?.hiddenContextBefore, 0);
  assert.equal(hunks[0]?.hiddenContextAfter, 0);
  assert.equal(hunks[1]?.hiddenContextBefore, 4);
  assert.equal(hunks[1]?.hiddenContextAfter, 0);
  assert.deepEqual(hunks[1]?.lines, [context("seven"), added("eight"), context("nine")]);
});
