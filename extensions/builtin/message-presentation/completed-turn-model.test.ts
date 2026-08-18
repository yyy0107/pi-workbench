import assert from "node:assert/strict";
import test from "node:test";

const { completedWorkBoundary, formatCompletedDuration } = (await import(
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

test("formats a completed duration without leading zeroes", () => {
  assert.equal(formatCompletedDuration(90_061_000), "1d1h1m1s");
  assert.equal(formatCompletedDuration(90_000_000), "1d1h");
  assert.equal(formatCompletedDuration(3_723_600), "1h2m4s");
  assert.equal(formatCompletedDuration(3_600_000), "1h");
  assert.equal(formatCompletedDuration(123_600), "2m4s");
  assert.equal(formatCompletedDuration(60_000), "1m");
  assert.equal(formatCompletedDuration(4_400), "4s");
  assert.equal(formatCompletedDuration(undefined), "");
  assert.equal(formatCompletedDuration(-1_000), "");
});
