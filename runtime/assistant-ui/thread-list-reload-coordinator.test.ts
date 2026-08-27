import assert from "node:assert/strict";
import test from "node:test";

import { createThreadListReloadCoordinator } from "./thread-list-reload-coordinator";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("coalesces same-turn thread-list invalidations", async () => {
  let reloads = 0;
  const coordinator = createThreadListReloadCoordinator({
    reload: async () => {
      reloads += 1;
    },
    onError: assert.fail,
  });

  coordinator.request();
  coordinator.request();
  coordinator.request();
  assert.equal(reloads, 0);

  await flushMicrotasks();
  assert.equal(reloads, 1);
});

test("runs one trailing reload for invalidations received in flight", async () => {
  const first = deferred();
  const second = deferred();
  const tasks = [first, second];
  let reloads = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const coordinator = createThreadListReloadCoordinator({
    reload: async () => {
      const task = tasks[reloads];
      reloads += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await task?.promise;
      concurrent -= 1;
    },
    onError: assert.fail,
  });

  coordinator.request();
  await flushMicrotasks();
  assert.equal(reloads, 1);

  coordinator.request();
  coordinator.request();
  coordinator.request();
  first.resolve();
  await flushMicrotasks();
  assert.equal(reloads, 2);
  assert.equal(maxConcurrent, 1);

  second.resolve();
  await flushMicrotasks();
  assert.equal(reloads, 2);
});

test("reports a failed reload once and accepts a later invalidation", async () => {
  const expected = new Error("reload failed");
  const errors: unknown[] = [];
  let reloads = 0;
  const coordinator = createThreadListReloadCoordinator({
    reload: async () => {
      reloads += 1;
      if (reloads === 1) throw expected;
    },
    onError: (error) => errors.push(error),
  });

  coordinator.request();
  await flushMicrotasks();
  assert.equal(reloads, 1);
  assert.deepEqual(errors, [expected]);

  coordinator.request();
  await flushMicrotasks();
  assert.equal(reloads, 2);
  assert.deepEqual(errors, [expected]);
});

test("does not start or trail reloads after disposal", async () => {
  const active = deferred();
  let reloads = 0;
  const coordinator = createThreadListReloadCoordinator({
    reload: async () => {
      reloads += 1;
      await active.promise;
    },
    onError: assert.fail,
  });

  coordinator.request();
  await flushMicrotasks();
  coordinator.request();
  coordinator.dispose();
  active.resolve();
  await flushMicrotasks();
  assert.equal(reloads, 1);

  const disposedBeforeStart = createThreadListReloadCoordinator({
    reload: async () => {
      reloads += 1;
    },
    onError: assert.fail,
  });
  disposedBeforeStart.request();
  disposedBeforeStart.dispose();
  await flushMicrotasks();
  assert.equal(reloads, 1);
});
