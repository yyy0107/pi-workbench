import assert from "node:assert/strict";
import test from "node:test";
import { markdownGraphemeEnds, MarkdownRevealClock } from "./markdown-reveal";

test("character boundaries retain emoji, combining marks and split surrogate pairs", () => {
  const text = "中e\u0301👨‍👩‍👧‍👦🇨🇳文";
  const ends = markdownGraphemeEnds(text);
  assert.equal(ends.length, 5);
  assert.deepEqual(
    ends.map((end, index) => text.slice(ends[index - 1] ?? 0, end)),
    ["中", "e\u0301", "👨‍👩‍👧‍👦", "🇨🇳", "文"],
  );
  assert.deepEqual(markdownGraphemeEnds("中\uD83D"), [1]);
});

test("reveal timing is sequential and bounds even very large bursts", () => {
  const clock = new MarkdownRevealClock();
  assert.deepEqual(clock.schedule(3, 100), [100, 116, 132]);
  assert.deepEqual(clock.schedule(2, 101), [148, 164]);
  for (const count of [1, 100, 10_000]) {
    const times = clock.schedule(count, 110);
    assert.equal(times.length, count);
    assert.ok(
      times.every(
        (time, index) => time >= 110 && time <= 270 && (index === 0 || time >= times[index - 1]),
      ),
    );
  }
  assert.deepEqual(clock.schedule(0, 110), []);
});

test("all text leaves share one frame and unsubscribing cancels pending work", () => {
  const descriptors = ["requestAnimationFrame", "cancelAnimationFrame"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  Object.assign(globalThis, {
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.set(++next, callback);
      return next;
    },
    cancelAnimationFrame(id: number) {
      frames.delete(id);
    },
  });
  try {
    const clock = new MarkdownRevealClock();
    const seen: number[] = [];
    const off1 = clock.subscribe((now) => {
      seen.push(now);
      return false;
    });
    const off2 = clock.subscribe((now) => {
      seen.push(now);
      return true;
    });
    assert.equal(frames.size, 1);
    const [id, callback] = [...frames][0];
    frames.delete(id);
    callback(16);
    assert.deepEqual(seen, [16, 16]);
    assert.equal(frames.size, 1);
    off1();
    off2();
    assert.equal(frames.size, 0);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
