import assert from "node:assert/strict";
import test from "node:test";

import {
  describeScheduleCron,
  formatRelativeTimeUntil,
  parseScheduleCron,
} from "./automation-schedule";

test("describes a custom schedule in the active locale", () => {
  assert.equal(describeScheduleCron("*/5 * * * *", "en-US"), "Every 5 minutes");
  assert.equal(describeScheduleCron("*/5 * * * *", "zh-CN"), "每隔 5 分钟");
  assert.equal(describeScheduleCron("", "zh-CN"), undefined);
  assert.equal(describeScheduleCron("not a cron expression", "zh-CN"), undefined);
});

test("parses the automation form's standard schedule expressions", () => {
  assert.deepEqual(parseScheduleCron("18 8 * * *"), {
    frequency: "daily",
    time: "08:18",
    customCron: "",
  });
  assert.deepEqual(parseScheduleCron("0 9 * * 1-5"), {
    frequency: "weekdays",
    time: "09:00",
    customCron: "",
  });
  assert.deepEqual(parseScheduleCron("0 * * * *"), {
    frequency: "hourly",
    time: "09:00",
    customCron: "",
  });
});

test("keeps unsupported cron expressions available for display and editing", () => {
  assert.deepEqual(parseScheduleCron("0 16 * * 5"), {
    frequency: "custom",
    time: "09:00",
    customCron: "0 16 * * 5",
  });
});

test("formats the next run using the most useful relative-time unit", () => {
  const calls: Array<[number, Intl.RelativeTimeFormatUnit]> = [];
  const relativeTime = (value: number, unit: Intl.RelativeTimeFormatUnit) => {
    calls.push([value, unit]);
    return `${value}:${unit}`;
  };

  assert.equal(formatRelativeTimeUntil(15 * 60 * 60 * 1_000, 0, relativeTime), "15:hour");
  assert.deepEqual(calls, [[15, "hour"]]);
});
