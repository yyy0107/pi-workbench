import assert from "node:assert/strict";
import test from "node:test";

const { formatAdaptiveDuration, formatCompactDuration } = (await import(
  new URL("./format-duration.ts", import.meta.url).href
)) as typeof import("./format-duration");

test("formats compact elapsed durations and omits empty units", () => {
  assert.equal(formatCompactDuration(90_061_000, "en-US"), "1d 1h 1m 1s");
  assert.equal(formatCompactDuration(90_000_000, "en-US"), "1d 1h");
  assert.equal(formatCompactDuration(3_723_600, "en-US"), "1h 2m 4s");
  assert.equal(formatCompactDuration(123_600, "en-US"), "2m 4s");
  assert.equal(formatCompactDuration(60_000, "en-US"), "1m");
  assert.equal(formatCompactDuration(4_400, "en-US"), "4s");
  assert.equal(formatCompactDuration(3_723_600, "zh-CN"), "1小时2分钟4秒");
});

test("formats zero duration only when requested", () => {
  assert.equal(formatCompactDuration(0, "en-US"), "");
  assert.equal(formatCompactDuration(0, "en-US", { includeZero: true }), "0s");
  assert.equal(formatCompactDuration(0, "zh-CN", { includeZero: true }), "0秒");
});

test("formats measured durations with locale-aware adaptive units", () => {
  assert.equal(formatAdaptiveDuration(249.6, "en-US"), "250ms");
  assert.equal(formatAdaptiveDuration(1_250, "en-US"), "1.25s");
  assert.equal(formatAdaptiveDuration(1_250, "zh-CN"), "1.25秒");
  assert.equal(formatAdaptiveDuration(61_000, "en-US"), "1m 1s");
  assert.equal(formatAdaptiveDuration(61_000, "zh-CN"), "1分钟1秒");
});

test("supports display precision and normalizes invalid measured durations", () => {
  assert.equal(
    formatAdaptiveDuration(1_000, "en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
    "1.0s",
  );
  assert.equal(formatAdaptiveDuration(-50, "en-US"), "0ms");
  assert.equal(formatAdaptiveDuration(Number.POSITIVE_INFINITY, "en-US"), "0ms");
});
