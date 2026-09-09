import assert from "node:assert/strict";
import test from "node:test";
import { createPointerTrajectory } from "../src/pointer-motion";

test("pointer trajectories curve, ease in and out, stay bounded and land exactly", (t) => {
  t.mock.method(Math, "random", () => 0.75);
  const viewport = { width: 800, height: 600 };
  const from = { x: 20, y: 30 };
  const to = { x: 720, y: 480 };
  const points = createPointerTrajectory(from, to, viewport);
  assert.ok(points.length > 20 && points.length <= 45);
  assert.deepEqual({ x: points.at(-1)!.x, y: points.at(-1)!.y }, to);
  const speed = points.map((point, index) => {
    const previous = points[index - 1] ?? from;
    return Math.hypot(point.x - previous.x, point.y - previous.y) / point.delayMs;
  });
  assert.ok(speed[0]! < Math.max(...speed) / 4);
  assert.ok(speed.at(-1)! < Math.max(...speed) / 4);
  assert.ok(
    points.some(
      (point) =>
        Math.abs((point.x - from.x) * (to.y - from.y) - (point.y - from.y) * (to.x - from.x)) >
        1000,
    ),
  );
  const duration = points.reduce((sum, point) => sum + point.delayMs, 0);
  assert.ok(duration <= 750);
  assert.ok(
    duration >
      createPointerTrajectory(from, { x: 40, y: 30 }, viewport).reduce(
        (sum, point) => sum + point.delayMs,
        0,
      ),
  );
  assert.deepEqual(createPointerTrajectory(from, from, viewport), []);
  for (const start of [
    { x: 0, y: 0 },
    { x: 799, y: 599 },
  ])
    for (const end of [
      { x: 0, y: 599 },
      { x: 799, y: 0 },
      { x: 0.25, y: 0.75 },
    ]) {
      const path = createPointerTrajectory(start, end, viewport);
      assert.ok(
        path.every(
          (point) =>
            point.x >= 0 &&
            point.x <= viewport.width &&
            point.y >= 0 &&
            point.y <= viewport.height &&
            point.delayMs > 0,
        ),
      );
      assert.deepEqual({ x: path.at(-1)!.x, y: path.at(-1)!.y }, end);
    }
  assert.throws(() => createPointerTrajectory(from, { x: NaN, y: 0 }, viewport), RangeError);
});
