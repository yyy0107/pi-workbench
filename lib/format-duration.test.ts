import assert from "node:assert/strict";
import test from "node:test";

const { formatCompactDuration } = (await import(
  new URL("./format-duration.ts", import.meta.url).href
)) as typeof import("./format-duration");

test("formats compact elapsed durations and omits empty units", () => {
  assert.equal(formatCompactDuration(90_061_000), "1d1h1m1s");
  assert.equal(formatCompactDuration(90_000_000), "1d1h");
  assert.equal(formatCompactDuration(3_723_600), "1h2m4s");
  assert.equal(formatCompactDuration(123_600), "2m4s");
  assert.equal(formatCompactDuration(60_000), "1m");
  assert.equal(formatCompactDuration(4_400), "4s");
});

test("uses the requested zero-duration fallback", () => {
  assert.equal(formatCompactDuration(0), "");
  assert.equal(formatCompactDuration(0, { zeroValue: "0s" }), "0s");
});
