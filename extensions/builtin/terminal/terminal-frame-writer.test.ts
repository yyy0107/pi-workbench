import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalFrameWriter, type TerminalFrameScheduler } from "./terminal-frame-writer";

function frameHarness() {
  let nextFrame = 1;
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const scheduler: TerminalFrameScheduler = {
    requestFrame(callback) {
      const frame = nextFrame++;
      callbacks.set(frame, callback);
      return frame;
    },
    cancelFrame(frame) {
      cancelled.push(frame);
      callbacks.delete(frame);
    },
  };
  return {
    cancelled,
    run(frame: number) {
      const callback = callbacks.get(frame);
      callbacks.delete(frame);
      callback?.();
    },
    scheduler,
  };
}

test("coalesces terminal chunks into one write per animation frame", () => {
  const frames = frameHarness();
  const writes: string[] = [];
  const writer = createTerminalFrameWriter(
    { write: (data) => writes.push(data) },
    frames.scheduler,
  );

  writer.enqueue("one");
  writer.enqueue("two");
  assert.deepEqual(writes, []);

  frames.run(1);
  assert.deepEqual(writes, ["onetwo"]);
});

test("flushes buffered output before terminal lifecycle changes", () => {
  const frames = frameHarness();
  const writes: string[] = [];
  const writer = createTerminalFrameWriter(
    { write: (data) => writes.push(data) },
    frames.scheduler,
  );

  writer.enqueue("pending");
  writer.flush();

  assert.deepEqual(writes, ["pending"]);
  assert.deepEqual(frames.cancelled, [1]);
});

test("runs duplicate completion work once after a batched write", () => {
  const frames = frameHarness();
  let parsed: (() => void) | undefined;
  let completions = 0;
  const complete = () => {
    completions += 1;
  };
  const writer = createTerminalFrameWriter(
    {
      write(_data, callback) {
        parsed = callback;
      },
    },
    frames.scheduler,
  );

  writer.enqueue("one", complete);
  writer.enqueue("two", complete);
  frames.run(1);
  assert.equal(completions, 0);

  parsed?.();
  assert.equal(completions, 1);
});

test("drops buffered output when disposed", () => {
  const frames = frameHarness();
  const writes: string[] = [];
  const writer = createTerminalFrameWriter(
    { write: (data) => writes.push(data) },
    frames.scheduler,
  );

  writer.enqueue("discarded");
  writer.dispose();
  frames.run(1);

  assert.deepEqual(writes, []);
  assert.deepEqual(frames.cancelled, [1]);
});
