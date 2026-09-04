import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { SessionEvent } from "@workbench/agent-runtime-pi-protocol/rpc";

import { ColdSessionEventCache } from "../../src/sessions/cold-session-event-cache";

function event(seq: number): SessionEvent {
  return { type: "message", seq, time: seq, data: { role: "user", content: `${seq}` } };
}

async function fixture(t: test.TestContext, name = "session.jsonl"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-cold-event-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, name);
  await writeFile(file, "initial\n");
  return file;
}

test("reuses a completed cold load and protects it from caller array mutation", async (t) => {
  const file = await fixture(t);
  const cache = new ColdSessionEventCache();
  let loads = 0;
  const load = () => {
    loads += 1;
    return [event(0)];
  };

  const first = await cache.load(file, load);
  first.length = 0;
  const second = await cache.load(file, load);

  assert.equal(loads, 1);
  assert.deepEqual(second, [event(0)]);
});

test("coalesces concurrent loads for the same canonical path and fingerprint", async (t) => {
  const file = await fixture(t);
  const cache = new ColdSessionEventCache();
  let loads = 0;
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = async () => {
    loads += 1;
    started();
    await gate;
    return [event(0)];
  };

  const first = cache.load(file, load);
  await startedPromise;
  const second = cache.load(file, load);
  release();

  assert.deepEqual(await Promise.all([first, second]), [[event(0)], [event(0)]]);
  assert.equal(loads, 1);
});

test("invalidates on a fresh size or mtime fingerprint and after explicit mutations", async (t) => {
  const file = await fixture(t);
  const cache = new ColdSessionEventCache();
  let loads = 0;
  const load = () => [event(loads++)];

  assert.deepEqual(await cache.load(file, load), [event(0)]);
  await appendFile(file, "external change\n");
  assert.deepEqual(await cache.load(file, load), [event(1)]);
  cache.invalidate(file);
  assert.deepEqual(await cache.load(file, load), [event(2)]);
  assert.equal(loads, 3);
});

test("does not complete a cache entry when initialization changes the file", async (t) => {
  const file = await fixture(t);
  const cache = new ColdSessionEventCache();
  let loads = 0;

  await cache.load(file, async (canonicalPath) => {
    loads += 1;
    await appendFile(canonicalPath, "journal initialization\n");
    return [event(0)];
  });
  await cache.load(file, () => {
    loads += 1;
    return [event(1)];
  });

  assert.equal(loads, 2);
});

test("does not let explicit invalidation race an in-flight load back into the cache", async (t) => {
  const file = await fixture(t);
  const cache = new ColdSessionEventCache();
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let loads = 0;
  const first = cache.load(file, async () => {
    loads += 1;
    started();
    await gate;
    return [event(0)];
  });
  await startedPromise;
  cache.invalidate(file);
  release();
  await first;
  await cache.load(file, () => {
    loads += 1;
    return [event(1)];
  });

  assert.equal(loads, 2);
});

test("bounds completed entries with FIFO eviction rather than access recency", async (t) => {
  const first = await fixture(t, "first.jsonl");
  const root = path.dirname(first);
  const second = path.join(root, "second.jsonl");
  const third = path.join(root, "third.jsonl");
  await Promise.all([writeFile(second, "second\n"), writeFile(third, "third\n")]);
  const cache = new ColdSessionEventCache({
    maxCompletedEntries: 2,
    maxCompletedSourceBytes: 1_024,
  });
  const loads = new Map<string, number>();
  const load = (canonicalPath: string) => {
    loads.set(canonicalPath, (loads.get(canonicalPath) ?? 0) + 1);
    return [event(0)];
  };

  await cache.load(first, load);
  await cache.load(second, load);
  await cache.load(first, load);
  await cache.load(third, load);
  await cache.load(first, load);

  assert.equal(loads.get(first), 2, "a hit must not make the oldest entry recent");
});

test("does not retain a completed projection larger than the source-byte budget", async (t) => {
  const file = await fixture(t);
  const cache = new ColdSessionEventCache({
    maxCompletedEntries: 8,
    maxCompletedSourceBytes: 1,
  });
  let loads = 0;
  const load = () => {
    loads += 1;
    return [event(0)];
  };

  await cache.load(file, load);
  await cache.load(file, load);

  assert.equal(loads, 2);
});
