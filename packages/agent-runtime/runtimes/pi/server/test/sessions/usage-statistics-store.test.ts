import assert from "node:assert/strict";
import test from "node:test";
import fs, { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { UsageStatisticsStore } from "../../src/sessions/usage-statistics-store";

function entry(id: string, timestamp = "2026-01-01T12:00:00Z") {
  return {
    type: "message",
    id,
    timestamp,
    parentId: null,
    message: {
      role: "assistant",
      timestamp: Date.parse(timestamp),
      provider: "provider",
      model: "model",
      content: [{ type: "text", text: "PRIVATE BODY 不应进入统计索引" }],
      usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
    },
  };
}
const signal = () => new AbortController().signal;

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "usage-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionRoot = path.join(root, "sessions");
  const directory = path.join(root, "workbench-usage-v1");
  await mkdir(sessionRoot);
  let files: string[] = [];
  let scans = 0;
  let now = new Date("2026-01-02T12:00:00Z");
  const listFiles = async () => {
    scans++;
    return Promise.all(
      files.map(async (file) => {
        const info = await stat(file);
        return { path: file, fingerprint: `${info.size}:${info.mtimeMs}` };
      }),
    );
  };
  const create = () => new UsageStatisticsStore(sessionRoot, listFiles, () => now);
  const save = async (name: string, entries = [entry(name)]) => {
    const file = path.join(sessionRoot, `${name}.jsonl`);
    await writeFile(file, entries.map((value) => JSON.stringify(value)).join("\n") + "\n");
    if (!files.includes(file)) files.push(file);
    return file;
  };
  return {
    root,
    directory,
    sessionRoot,
    create,
    save,
    listFiles,
    scans: () => scans,
    setNow: (value: string) => {
      now = new Date(value);
    },
    remove: (file: string) => {
      files = files.filter((value) => value !== file);
    },
  };
}

test("persisted snapshots bypass catalog and source reads; unchanged refresh reuses the aggregate and index", async (t) => {
  const f = await fixture(t);
  const file = await f.save("one");
  const store = f.create();
  const first = await store.read({ timeZone: "UTC" }, signal());
  assert.equal(first.totalTokens, 100);
  const before = await stat(path.join(f.directory, "index.json"));
  const snapshotBefore = await stat(path.join(f.directory, "snapshots.json"));
  const same = await store.read({ timeZone: "UTC" }, signal());
  assert.equal(same, first, "must reuse the aggregate object, not recalculate it");
  assert.equal((await stat(path.join(f.directory, "index.json"))).mtimeMs, before.mtimeMs);
  assert.equal(
    (await stat(path.join(f.directory, "snapshots.json"))).mtimeMs,
    snapshotBefore.mtimeMs,
  );

  let sourceReads = 0;
  const original = fs.readFile;
  const mock = t.mock.method(fs, "readFile", (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] === file) sourceReads++;
    return original(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
  });
  const restarted = f.create();
  const scans = f.scans();
  assert.deepEqual(await restarted.read({ timeZone: "UTC", preferCached: true }, signal()), first);
  assert.equal(f.scans(), scans, "cached startup must not scan the catalog");
  assert.deepEqual(await restarted.read({ timeZone: "UTC" }, signal()), first);
  assert.equal(sourceReads, 0, "restart must restore the message index without parsing JSONL");
  for (const name of ["index.json", "snapshots.json"]) {
    assert.equal(
      (await readFile(path.join(f.directory, name), "utf8")).includes("PRIVATE BODY"),
      false,
    );
    assert.equal((await stat(path.join(f.directory, name))).mode & 0o777, 0o600);
  }
});

test("changed sessions, forks and deletions reconcile without counting inherited messages twice", async (t) => {
  const f = await fixture(t);
  const a = await f.save("a", [entry("inherited")]);
  const b = await f.save("b", [entry("inherited"), entry("branch")]);
  const store = f.create();
  assert.equal((await store.read({ timeZone: "UTC" }, signal())).totalTokens, 200);
  await f.save("a", [entry("inherited"), entry("new", "2026-01-02T11:00:00Z")]);
  assert.equal((await store.read({ timeZone: "UTC" }, signal())).totalTokens, 300);
  f.remove(a);
  assert.equal((await store.read({ timeZone: "UTC" }, signal())).totalTokens, 200);
  f.remove(b);
  assert.equal((await store.read({ timeZone: "UTC" }, signal())).totalTokens, 0);
});

test("concurrent reads share one reconciliation and one caller can cancel independently", async (t) => {
  const f = await fixture(t);
  await f.save("one");
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = new UsageStatisticsStore(
    f.sessionRoot,
    async () => {
      started();
      await gate;
      return f.listFiles();
    },
    () => new Date("2026-01-02"),
  );
  const controller = new AbortController();
  const first = store.read({ timeZone: "UTC" }, controller.signal);
  const second = store.read({ timeZone: "UTC" }, signal());
  await entered;
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  release();
  assert.equal((await second).totalTokens, 100);
  assert.equal(f.scans(), 1);
});

test("all cancelled callers stop the generation and a subsequent read recovers", async (t) => {
  const f = await fixture(t);
  await f.save("one");
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = new UsageStatisticsStore(f.sessionRoot, async () => {
    entered();
    await gate;
    return f.listFiles();
  });
  const controller = new AbortController();
  const pending = store.read({ timeZone: "UTC" }, controller.signal);
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  release();
  assert.equal((await store.read({ timeZone: "UTC" }, signal())).totalTokens, 100);
});

test("time zone, local midnight and future message timestamps invalidate the right projection", async (t) => {
  const f = await fixture(t);
  await f.save("one", [
    entry("past", "2026-01-01T00:01:00Z"),
    entry("future", "2026-01-02T13:00:00Z"),
  ]);
  const store = f.create();
  assert.equal((await store.read({ timeZone: "UTC" }, signal())).totalTokens, 100);
  const local = await store.read({ timeZone: "America/Los_Angeles" }, signal());
  assert.equal(local.days[0]!.date, "2025-12-31");
  f.setNow("2026-01-02T13:01:00Z");
  assert.equal(
    (await store.read({ timeZone: "UTC", preferCached: true }, signal())).totalTokens,
    200,
  );
  f.setNow("2026-01-04T00:00:01Z");
  const nextDay = await store.read({ timeZone: "UTC", preferCached: true }, signal());
  assert.equal(nextDay.today, "2026-01-04");
  assert.equal(nextDay.currentStreak, 0);
});

test("corrupt or incompatible cache documents rebuild from source", async (t) => {
  const f = await fixture(t);
  await f.save("one");
  await mkdir(f.directory);
  await writeFile(path.join(f.directory, "index.json"), '{"version":999}');
  await writeFile(path.join(f.directory, "snapshots.json"), "{broken");
  assert.equal(
    (await f.create().read({ timeZone: "UTC", preferCached: true }, signal())).totalTokens,
    100,
  );
  assert.equal(JSON.parse(await readFile(path.join(f.directory, "index.json"), "utf8")).version, 1);
});

test("failed persistence preserves computed statistics and retries on the next refresh", async (t) => {
  const f = await fixture(t);
  await f.save("one");
  await writeFile(f.directory, "blocks cache directory creation");
  const store = f.create();
  const first = await store.read({ timeZone: "UTC" }, signal());
  assert.equal(first.totalTokens, 100);
  await rm(f.directory);
  assert.equal(await store.read({ timeZone: "UTC" }, signal()), first);
  assert.equal(
    (await f.create().read({ timeZone: "UTC", preferCached: true }, signal())).totalTokens,
    100,
  );
});
