import assert from "node:assert/strict";
import test from "node:test";

import type { PiPackageUpdatesValue } from "@/workbench/runtime-contributions/pi/protocol/rpc";

import { createPiPackageUpdatesQuery } from "./pi-package-updates-query";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

const USER_TARGET = { scope: "user" as const };
const FIRST_VALUE: PiPackageUpdatesValue = {
  updates: [
    {
      source: "npm:pi-example",
      displayName: "pi-example",
      type: "npm",
      scope: "user",
      filtered: false,
      currentVersion: "1.0.0",
      targetVersion: "1.1.0",
    },
  ],
};

test("shares an in-flight package update request and reuses its fresh result", async () => {
  const firstRequest = deferred<PiPackageUpdatesValue>();
  let calls = 0;
  const query = createPiPackageUpdatesQuery({
    load: () => {
      calls += 1;
      return firstRequest.promise;
    },
  });

  const first = query.ensure(USER_TARGET);
  const second = query.ensure(USER_TARGET);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.deepEqual(query.getSnapshot(USER_TARGET), {
    isRefreshing: false,
    loadState: "loading",
    refreshFailed: false,
    value: { updates: [] },
  });

  firstRequest.resolve(FIRST_VALUE);
  await first;
  await query.ensure(USER_TARGET);

  assert.equal(calls, 1);
  assert.deepEqual(query.getSnapshot(USER_TARGET), {
    isRefreshing: false,
    loadState: "ready",
    refreshFailed: false,
    value: FIRST_VALUE,
  });
});

test("keeps the previous package update list visible while a stale result refreshes", async () => {
  let now = 1_000;
  const refreshRequest = deferred<PiPackageUpdatesValue>();
  let calls = 0;
  const query = createPiPackageUpdatesQuery({
    maxAgeMs: 100,
    now: () => now,
    load: async () => {
      calls += 1;
      if (calls === 1) return FIRST_VALUE;
      return refreshRequest.promise;
    },
  });

  await query.ensure(USER_TARGET);
  now += 101;
  const refresh = query.ensure(USER_TARGET);

  assert.deepEqual(query.getSnapshot(USER_TARGET), {
    isRefreshing: true,
    loadState: "ready",
    refreshFailed: false,
    value: FIRST_VALUE,
  });

  refreshRequest.reject(new Error("registry unavailable"));
  await refresh;

  assert.deepEqual(query.getSnapshot(USER_TARGET), {
    isRefreshing: false,
    loadState: "ready",
    refreshFailed: true,
    value: FIRST_VALUE,
  });
});

test("invalidating an observed target schedules one background recheck", async () => {
  const refreshRequest = deferred<PiPackageUpdatesValue>();
  let calls = 0;
  const query = createPiPackageUpdatesQuery({
    load: async () => {
      calls += 1;
      if (calls === 1) return FIRST_VALUE;
      return refreshRequest.promise;
    },
  });
  const unsubscribe = query.subscribe(USER_TARGET, () => undefined);

  await query.ensure(USER_TARGET);
  query.invalidate(USER_TARGET);

  assert.equal(calls, 2);
  assert.equal(query.getSnapshot(USER_TARGET).isRefreshing, true);

  refreshRequest.resolve({ updates: [] });
  await query.ensure(USER_TARGET);
  assert.deepEqual(query.getSnapshot(USER_TARGET).value, { updates: [] });
  unsubscribe();
});
