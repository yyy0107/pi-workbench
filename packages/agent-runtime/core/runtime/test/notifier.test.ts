import assert from "node:assert/strict";
import test from "node:test";

import type { HostObservable } from "../src/observable";
import { Notifier } from "../src/notifier";

const flushMicrotask = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("Notifier batches microtask changes and rebuilds before notifying", async () => {
  const order: string[] = [];
  const notifier = new Notifier(() => order.push("rebuild"));
  notifier.subscribe(() => order.push("notify"));

  notifier.markDirty();
  notifier.markDirty();
  notifier.markDirty();

  assert.deepEqual(order, []);
  await flushMicrotask();
  assert.deepEqual(order, ["rebuild", "notify"]);
});

test("Notifier preserves a cached snapshot and a pending notification across a pull", async () => {
  let state = 0;
  let builds = 0;
  let snapshot = Object.freeze({ value: state });
  const notifier = new Notifier(() => {
    builds += 1;
    snapshot = Object.freeze({ value: state });
  });
  const observable: HostObservable<Readonly<{ value: number }>> = {
    getSnapshot() {
      notifier.ensureFresh();
      return snapshot;
    },
    subscribe: notifier.subscribe,
  };
  let notifiedSnapshot: Readonly<{ value: number }> | undefined;
  observable.subscribe(() => {
    notifiedSnapshot = observable.getSnapshot();
  });

  state = 1;
  notifier.markDirty();
  const pulledSnapshot = observable.getSnapshot();

  assert.equal(builds, 1);
  assert.strictEqual(observable.getSnapshot(), pulledSnapshot);
  await flushMicrotask();
  assert.strictEqual(notifiedSnapshot, pulledSnapshot);
  assert.equal(builds, 1);
});

test("Notifier batches streaming changes into one animation frame", () => {
  const runtimeGlobal = globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: () => void) => number;
  };
  const original = runtimeGlobal.requestAnimationFrame;
  const frames: Array<() => void> = [];
  runtimeGlobal.requestAnimationFrame = (callback) => frames.push(callback);

  try {
    const order: string[] = [];
    const notifier = new Notifier(() => order.push("rebuild"));
    notifier.subscribe(() => order.push("notify"));

    notifier.markFrameDirty();
    notifier.markFrameDirty();
    notifier.markFrameDirty();

    assert.equal(frames.length, 1);
    assert.deepEqual(order, []);
    frames[0]?.();
    assert.deepEqual(order, ["rebuild", "notify"]);
  } finally {
    if (original) runtimeGlobal.requestAnimationFrame = original;
    else delete runtimeGlobal.requestAnimationFrame;
  }
});

test("Notifier publishes immediately and invalidates an older scheduled frame", () => {
  const runtimeGlobal = globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: () => void) => number;
  };
  const original = runtimeGlobal.requestAnimationFrame;
  const frames: Array<() => void> = [];
  runtimeGlobal.requestAnimationFrame = (callback) => frames.push(callback);

  try {
    let builds = 0;
    let notifications = 0;
    const notifier = new Notifier(() => {
      builds += 1;
    });
    notifier.subscribe(() => {
      notifications += 1;
    });

    notifier.markFrameDirty();
    notifier.notifyNow();

    assert.equal(builds, 1);
    assert.equal(notifications, 1);
    frames[0]?.();
    assert.equal(builds, 1);
    assert.equal(notifications, 1);
  } finally {
    if (original) runtimeGlobal.requestAnimationFrame = original;
    else delete runtimeGlobal.requestAnimationFrame;
  }
});
