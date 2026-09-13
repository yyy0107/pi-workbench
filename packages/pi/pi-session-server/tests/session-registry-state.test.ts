import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveSessionRegistryState,
  PersistedSessionRegistryState,
  processPiSessionRegistryState,
  ScratchSessionRegistryState,
  SessionForkSerializer,
} from "../src/session-registry-state";

interface TestHost {
  readonly id: string;
  readonly isAlive: boolean;
  readonly isRunning: boolean;
  shutdown(): Promise<void>;
}

function host(id: string): TestHost {
  return { id, isAlive: true, isRunning: false, shutdown: async () => undefined };
}

test("live session state detaches only the authoritative host instance", () => {
  const state = new LiveSessionRegistryState<TestHost>();
  const first = host("same");
  const replacement = host("same");
  state.attach(first);
  state.attach(replacement);

  assert.equal(state.detach(first), false);
  assert.equal(state.sessions.get("same"), replacement);
  assert.equal(state.detach(replacement), true);
  assert.equal(state.sessions.has("same"), false);
});

test("live session owner coalesces start ownership and running subscriptions", async () => {
  const state = new LiveSessionRegistryState<TestHost>();
  const running = { ...host("running"), isRunning: true };
  state.attach(running);
  assert.deepEqual(state.runningIds(), ["running"]);

  const task = Promise.resolve(host("starting"));
  assert.equal(state.trackStart("starting", task), task);
  assert.equal(state.getStart("starting"), task);
  await task;
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(state.getStart("starting"), undefined);

  let calls = 0;
  const unsubscribe = state.subscribeRunning(() => calls++);
  for (const listener of state.runningListeners) listener(["running"]);
  unsubscribe();
  assert.equal(calls, 1);
  assert.equal(state.runningListeners.size, 0);
});

test("HMR adoption retains legacy map identity and redirects in-flight scalar writes", () => {
  const processGlobal = globalThis as typeof globalThis & { __workbenchPiRegistry?: unknown };
  const previous = processGlobal.__workbenchPiRegistry;
  const sessions = new Map<string, TestHost>();
  const startLocks = new Map<string, Promise<TestHost>>();
  const listeners = new Set<(ids: string[]) => void>();
  const pendingStart = Promise.resolve(host("pending"));
  startLocks.set("pending", pendingStart);
  const cold = new PersistedSessionRegistryState();
  const scratch = new ScratchSessionRegistryState();
  const expiryTimer = setTimeout(() => {}, 60_000);
  expiryTimer.unref();
  const scratchRecord = {
    id: "scratch",
    sourceSessionId: "source",
    cwd: "/workspace",
    filePath: "/tmp/scratch.jsonl",
    createdAt: 1,
    expiresAt: 2,
    expiryTimer,
  };
  scratch.set(scratchRecord);
  const forkTail = Promise.resolve();
  const cacheTask = Promise.resolve();
  const legacy = {
    sessions,
    startLocks,
    runningListeners: listeners,
    lastRunningKey: "before",
    persistedSessions: cold.sessions,
    persistedSessionSummaries: cold.summaries,
    persistedSessionFingerprints: cold.fingerprints,
    persistedSessionCacheTask: cacheTask,
    scratchSessions: scratch.sessions,
    forkTail,
  };
  processGlobal.__workbenchPiRegistry = legacy;
  try {
    const adopted = processPiSessionRegistryState<TestHost>();
    assert.equal(adopted as unknown, legacy);
    assert.equal(adopted.live.sessions, sessions);
    assert.equal(adopted.live.startLocks, startLocks);
    assert.equal(adopted.live.runningListeners, listeners);
    assert.equal(adopted.live.getStart("pending"), pendingStart);
    assert.equal(adopted.persisted.sessions, cold.sessions);
    assert.equal(adopted.persisted.summaries, cold.summaries);
    assert.equal(adopted.persisted.fingerprints, cold.fingerprints);
    assert.equal(adopted.persisted.cacheTask, cacheTask);
    assert.equal(adopted.scratch.sessions, scratch.sessions);
    assert.equal(adopted.scratch.get("scratch"), scratchRecord);
    assert.equal(adopted.scratch.get("scratch")?.expiryTimer, expiryTimer);
    assert.equal(adopted.forks.tail, forkTail);
    const lateCacheTask = Promise.resolve();
    legacy.persistedSessionCacheTask = lateCacheTask;
    assert.equal(adopted.persisted.cacheTask, lateCacheTask);

    legacy.lastRunningKey = "from-old-closure";
    assert.equal(adopted.live.lastRunningKey, "from-old-closure");
    adopted.live.lastRunningKey = "from-new-owner";
    assert.equal(legacy.lastRunningKey, "from-new-owner");
  } finally {
    clearTimeout(expiryTimer);
    processGlobal.__workbenchPiRegistry = previous;
  }
});

test("registry concerns own independent mutable state", () => {
  const live = new LiveSessionRegistryState<TestHost>();
  const persisted = new PersistedSessionRegistryState();
  const scratch = new ScratchSessionRegistryState();
  const forks = new SessionForkSerializer();

  live.attach(host("live"));
  persisted.cacheKey = "catalog";
  scratch.directory = "/tmp/scratch";
  forks.tail = Promise.resolve();

  assert.deepEqual([...live.sessions.keys()], ["live"]);
  assert.equal(persisted.cacheKey, "catalog");
  assert.equal(scratch.directory, "/tmp/scratch");
  assert.notEqual(live.sessions, persisted.sessions);
  assert.notEqual(persisted.sessions, scratch.sessions);
});

test("fork serialization retains one tail and releases it after a failed fork", async () => {
  const forks = new SessionForkSerializer();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const first = forks.run(async () => {
    order.push("first");
    await gate;
    throw new Error("fork failed");
  });
  const failed = assert.rejects(first, /fork failed/);
  const second = forks.run(async () => {
    order.push("second");
    return "created";
  });
  await Promise.resolve();
  assert.deepEqual(order, ["first"]);
  release();
  await failed;
  assert.equal(await second, "created");
  assert.deepEqual(order, ["first", "second"]);
});
