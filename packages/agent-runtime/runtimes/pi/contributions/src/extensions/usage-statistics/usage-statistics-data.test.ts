import assert from "node:assert/strict";
import test from "node:test";
import type { UsageStatisticsDay } from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  activityCalendar,
  offsetDate,
  smoothTrendPath,
  usageDays,
  usageTrendSeries,
} from "./usage-statistics-data";

const day = (date: string, tokens: number, provider = "a"): UsageStatisticsDay => ({
  date,
  tokens,
  messages: 1,
  models: [{ provider, model: "shared-name", tokens }],
});

test("calendar modes preserve local date keys, weekly totals, and lifetime cumulative usage", () => {
  const days = [day("2024-01-01", 20), day("2026-03-07", 100), day("2026-03-08", 200)];
  assert.equal(offsetDate("2024-03-01", -1), "2024-02-29");
  assert.equal(offsetDate("2026-01-01", -1), "2025-12-31");
  const daily = activityCalendar(days, "2026-03-09", "daily");
  assert.equal(daily.values.length, 365);
  assert.equal(daily.values.at(-1)!.value, 0);
  assert.ok(daily.columns * 7 >= daily.leading + 365);
  assert.equal(activityCalendar(days, "2026-03-09", "weekly").values.at(-1)!.value, 200);
  assert.equal(activityCalendar(days, "2026-03-09", "cumulative").values.at(-1)!.value, 320);
  assert.equal(activityCalendar(days, "2026-03-09", "cumulative").values[0]!.value, 20);
  assert.equal(
    activityCalendar([], "2026-03-09", "daily").values.every((item) => item.value === 0),
    true,
  );
});

test("7/30-day trends include today, fill missing days, and separate identical model names across providers", () => {
  const source = [day("2026-09-01", 100), day("2026-09-06", 50, "b")];
  const week = usageDays(source, "2026-09-06", 7);
  assert.equal(week.length, 7);
  assert.equal(week[0]!.date, "2026-08-31");
  assert.equal(week.at(-1)!.date, "2026-09-06");
  assert.equal(week[0]!.tokens, 0);
  const month = usageDays(source, "2026-09-06", 30);
  assert.equal(month.length, 30);
  assert.equal(month[0]!.date, "2026-08-08");
  const series = usageTrendSeries(week);
  assert.equal(series.length, 2);
  assert.notEqual(series[0]!.id, series[1]!.id);
  assert.deepEqual(series[0]!.values, [0, 100, 0, 0, 0, 0, 0]);
  assert.deepEqual(series[1]!.values, [0, 0, 0, 0, 0, 0, 50]);
});

test("provider groups sum their models and selecting a provider isolates its model trends", () => {
  const source = [day("2026-09-01", 100), day("2026-09-06", 50, "b")];
  source[0]!.models.push({ provider: "a", model: "second", tokens: 30 });
  source[1]!.models.push({ provider: "a", model: "second", tokens: 10 });
  source[1]!.models.push({ provider: "", model: "shared-name", tokens: 5 });
  const days = usageDays(source, "2026-09-06", 7);
  const groups = usageTrendSeries(days);
  assert.deepEqual(
    groups.map(({ provider, total }) => ({ provider, total })),
    [
      { provider: "a", total: 140 },
      { provider: "b", total: 50 },
      { provider: "", total: 5 },
    ],
  );
  assert.deepEqual(groups[0]!.values, [0, 130, 0, 0, 0, 0, 10]);
  const models = usageTrendSeries(days, "a");
  assert.deepEqual(
    models.map(({ model, total }) => ({ model, total })),
    [
      { model: "shared-name", total: 100 },
      { model: "second", total: 40 },
    ],
  );
  assert.deepEqual(models[1]!.values, [0, 30, 0, 0, 0, 0, 10]);
  assert.equal(
    models.reduce((sum, model) => sum + model.total, 0),
    groups[0]!.total,
  );
  assert.equal(usageTrendSeries(days, "")[0]!.total, 5);
  assert.deepEqual(usageTrendSeries(days, "missing"), []);
  assert.deepEqual(usageTrendSeries([]), []);
});

test("smooth trend curves pass through daily values without overshooting peaks or zero", () => {
  assert.equal(smoothTrendPath([]), "");
  assert.equal(smoothTrendPath([{ x: 0, y: 0 }]), "M 0 0");
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 100 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ];
  const path = smoothTrendPath(points);
  const segments = path.split(" C ");
  assert.equal(segments[0], "M 0 0");
  assert.equal(segments.length, points.length);
  for (const [index, segment] of segments.slice(1).entries()) {
    const [x1, y1, x2, y2, endX, endY] = segment.split(" ").map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const start = points[index]!;
    const end = points[index + 1]!;
    assert.deepEqual({ x: endX, y: endY }, end);
    assert.ok(x1 >= start.x && x1 <= x2 && x2 <= end.x);
    for (let step = 0; step <= 20; step++) {
      const t = step / 20;
      const value =
        (1 - t) ** 3 * start.y +
        3 * (1 - t) ** 2 * t * y1 +
        3 * (1 - t) * t ** 2 * y2 +
        t ** 3 * endY;
      assert.ok(value >= Math.min(start.y, end.y) && value <= Math.max(start.y, end.y));
    }
  }
});
