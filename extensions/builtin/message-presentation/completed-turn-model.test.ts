import assert from "node:assert/strict";
import test from "node:test";

const { completedWorkBoundary, formatCompletedDuration, partBelongsToCompletedWork } =
  (await import(
    new URL("./completed-turn-model.ts", import.meta.url).href
  )) as typeof import("./completed-turn-model");

test("keeps only the last text part outside completed work", () => {
  assert.equal(
    completedWorkBoundary([
      { type: "reasoning" },
      { type: "text" },
      { type: "tool-call" },
      { type: "text" },
    ]),
    3,
  );
});

test("includes every part when a completed turn has no text body", () => {
  assert.equal(completedWorkBoundary([{ type: "reasoning" }, { type: "tool-call" }]), 2);
});

test("folds every assistant work part before the final answer", () => {
  const boundary = completedWorkBoundary([{ type: "data" }]);

  assert.equal(partBelongsToCompletedWork("user", 0, boundary), false);
  assert.equal(partBelongsToCompletedWork("assistant", 0, boundary), true);
  assert.equal(partBelongsToCompletedWork("system", 0, boundary), false);
});

test("formats a completed duration without leading zeroes", () => {
  assert.equal(formatCompletedDuration(90_061_000, "en-US"), "1d 1h 1m 1s");
  assert.equal(formatCompletedDuration(90_000_000, "en-US"), "1d 1h");
  assert.equal(formatCompletedDuration(3_723_600, "en-US"), "1h 2m 4s");
  assert.equal(formatCompletedDuration(3_600_000, "en-US"), "1h");
  assert.equal(formatCompletedDuration(123_600, "en-US"), "2m 4s");
  assert.equal(formatCompletedDuration(60_000, "en-US"), "1m");
  assert.equal(formatCompletedDuration(4_400, "en-US"), "4s");
  assert.equal(formatCompletedDuration(3_723_600, "zh-CN"), "1小时2分钟4秒");
  assert.equal(formatCompletedDuration(undefined, "en-US"), "");
  assert.equal(formatCompletedDuration(-1_000, "en-US"), "");
});
