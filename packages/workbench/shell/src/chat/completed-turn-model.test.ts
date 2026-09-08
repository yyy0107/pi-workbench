import assert from "node:assert/strict";
import test from "node:test";

const {
  completedWorkBoundary,
  formatCompletedAt,
  formatCompletedDuration,
  partBelongsToCompletedWork,
} = (await import(
  new URL("./completed-turn-model.ts", import.meta.url).href
)) as typeof import("./completed-turn-model");

const zhCNFormatters = {
  date: (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("zh-CN", options).format(value),
};

test("keeps only the last text block outside completed work", () => {
  assert.equal(
    completedWorkBoundary([
      { kind: "reasoning" },
      { kind: "text" },
      { kind: "tool-call" },
      { kind: "text" },
    ]),
    3,
  );
});

test("includes every block when a completed turn has no text body", () => {
  assert.equal(completedWorkBoundary([{ kind: "reasoning" }, { kind: "tool-call" }]), 2);
});

test("keeps generated images outside completed work, including images before final text", () => {
  const image = { kind: "file", mediaType: "image/png" };
  assert.equal(completedWorkBoundary([image]), 0);
  assert.equal(completedWorkBoundary([{ kind: "reasoning" }, image]), 1);
  assert.equal(completedWorkBoundary([{ kind: "tool-call" }, image, image, { kind: "text" }]), 1);
  assert.equal(completedWorkBoundary([{ kind: "reasoning" }, { kind: "text" }, image]), 1);
  assert.equal(completedWorkBoundary([{ kind: "file", source: "data:image/png;base64,abc" }]), 0);
});

test("folds every assistant work block before the final answer", () => {
  const boundary = completedWorkBoundary([{ kind: "data" }]);

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

test("keeps the exact completion time for both today and historical dates", () => {
  const now = new Date(2026, 7, 27, 12).getTime();

  assert.equal(
    formatCompletedAt(new Date(2026, 7, 27, 17, 18, 14).getTime(), now, zhCNFormatters),
    "17:18:14",
  );
  assert.equal(
    formatCompletedAt(new Date(2026, 7, 26, 17, 18, 14).getTime(), now, zhCNFormatters),
    "8月26日 17:18:14",
  );
  assert.equal(
    formatCompletedAt(new Date(2026, 7, 25, 17, 18, 14).getTime(), now, zhCNFormatters),
    "8月25日 17:18:14",
  );
  assert.equal(
    formatCompletedAt(new Date(2026, 7, 24, 17, 18, 14).getTime(), now, zhCNFormatters),
    "8月24日 17:18:14",
  );
  assert.equal(
    formatCompletedAt(new Date(2026, 7, 24, 17, 18, 14), now, {
      date: (value, options) => new Intl.DateTimeFormat("en-US", options).format(value),
    }),
    "August 24 at 05:18:14 PM",
  );
});
