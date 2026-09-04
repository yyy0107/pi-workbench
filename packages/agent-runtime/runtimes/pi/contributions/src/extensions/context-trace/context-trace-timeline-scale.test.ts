import assert from "node:assert/strict";
import test from "node:test";

import { createContextTraceTimelineScale } from "./context-trace-timeline-scale";

test("gives each observed event interval equal timeline width", () => {
  const scale = createContextTraceTimelineScale([0, 10, 10_000]);

  assert.equal(scale.fractionAt(0), 0);
  assert.equal(scale.fractionAt(10), 0.5);
  assert.equal(scale.fractionAt(10_000), 1);
});

test("maps pointer fractions back through the compact event scale", () => {
  const scale = createContextTraceTimelineScale([100, 200, 1_000]);

  assert.equal(scale.timeAt(0.75), 600);
  assert.equal(scale.fractionAt(scale.timeAt(0.75)), 0.75);
});

test("deduplicates and orders event timestamps", () => {
  const scale = createContextTraceTimelineScale([1_000, 100, 100, 200]);

  assert.equal(scale.startTime, 100);
  assert.equal(scale.endTime, 1_000);
  assert.equal(scale.fractionAt(200), 0.5);
});

test("keeps empty and single-event timelines reversible", () => {
  const empty = createContextTraceTimelineScale([]);
  const single = createContextTraceTimelineScale([42]);

  assert.deepEqual([empty.startTime, empty.endTime, empty.timeAt(0.5)], [0, 1, 0.5]);
  assert.deepEqual([single.startTime, single.endTime, single.fractionAt(42.5)], [42, 43, 0.5]);
});
