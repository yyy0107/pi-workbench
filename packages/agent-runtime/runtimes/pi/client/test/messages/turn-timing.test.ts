import assert from "node:assert/strict";
import test from "node:test";

const { readPiTurnTiming, resolvePiTurnDuration } = (await import(
  new URL("../../src/messages/turn-timing.ts", import.meta.url).href
)) as typeof import("../../src/messages/turn-timing");

test("prefers the complete Pi turn duration over the final stream duration", () => {
  assert.equal(resolvePiTurnDuration({ startedAt: 1_000, completedAt: 13_000 }, 4_050), 12_000);
});

test("falls back to the assistant stream duration without complete Pi turn timing", () => {
  assert.equal(resolvePiTurnDuration(undefined, 4_050), 4_050);
  assert.equal(resolvePiTurnDuration({ startedAt: 13_000, completedAt: 1_000 }, 4_050), 4_050);
});

test("rejects incomplete and non-finite timing values", () => {
  assert.equal(readPiTurnTiming({ startedAt: 1_000 }), undefined);
  assert.equal(readPiTurnTiming({ startedAt: Number.NaN, completedAt: 2_000 }), undefined);
  assert.equal(resolvePiTurnDuration(undefined, -1), undefined);
});
