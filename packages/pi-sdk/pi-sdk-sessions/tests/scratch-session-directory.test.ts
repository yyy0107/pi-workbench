import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ScratchSessionDirectory } from "../src/scratch-session-directory";
import {
  ScratchSessionRegistryState,
  type ScratchSessionStateRecord,
} from "../src/session-registry-state";

function record(filePath: string, expiresAt = Date.now() + 10_000): ScratchSessionStateRecord {
  return {
    id: "scratch-1",
    sourceSessionId: "source",
    cwd: "/tmp",
    filePath,
    createdAt: Date.now(),
    expiresAt,
  };
}

test("allocates and retains one scratch directory and records", () => {
  const state = new ScratchSessionRegistryState();
  const directory = new ScratchSessionDirectory(state, {
    isBusy: () => false,
    release: async () => undefined,
    invalidateFile: () => undefined,
  });
  assert.equal(directory.directory(), directory.directory());
  const item = record(path.join(directory.directory(), "session.json"));
  directory.set(item);
  assert.equal(directory.get(item.id), item);
  assert.equal(directory.delete(item.id), true);
  assert.equal(directory.get(item.id), undefined);
});

test("busy expiry extends the record and retries using the same identity", async (t) => {
  const state = new ScratchSessionRegistryState();
  let now = 100;
  let busy = true;
  let releases = 0;
  const directory = new ScratchSessionDirectory(state, {
    now: () => now,
    isBusy: () => busy,
    release: async () => {
      releases += 1;
    },
    invalidateFile: () => undefined,
    retryDelayMs: 20,
  });
  const item = record(path.join(mkdtempSync(path.join(os.tmpdir(), "scratch-test-")), "a"), 100);
  directory.set(item);
  directory.scheduleExpiry(item);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(item.expiresAt, 120);
  busy = false;
  now = 120;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(releases, 1);
  directory.clearExpiry(item);
  t.after(() => void directory.shutdown());
});

test("shutdown clears timers, invalidates and removes files, and releases the directory", async () => {
  const state = new ScratchSessionRegistryState();
  const root = mkdtempSync(path.join(os.tmpdir(), "scratch-test-"));
  const filePath = path.join(root, "session.json");
  writeFileSync(filePath, "{}");
  const invalidated: string[] = [];
  const directory = new ScratchSessionDirectory(state, {
    isBusy: () => false,
    release: async () => undefined,
    invalidateFile: (file) => invalidated.push(file),
  });
  state.directory = root;
  const item = record(filePath);
  directory.set(item);
  directory.scheduleExpiry(item);
  await directory.shutdown();
  assert.deepEqual(invalidated, [filePath]);
  assert.equal(directory.get(item.id), undefined);
  assert.equal(state.directory, undefined);
});
