import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchSettingsPort, WorkbenchSettingsPreferencesPatch } from "../settings";

import { createThreadOrderStore } from "./thread-order-store";

test("thread-order stores isolate snapshots, listeners, and persistence queues", async () => {
  let releaseFirstWrite: (() => void) | undefined;
  let firstWriteStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    firstWriteStarted = resolve;
  });
  const writes = {
    first: [] as WorkbenchSettingsPreferencesPatch[],
    second: [] as WorkbenchSettingsPreferencesPatch[],
  };
  const service = (label: "first" | "second"): WorkbenchSettingsPort => ({
    async load() {
      return {};
    },
    async update(patch) {
      writes[label].push(patch);
      if (label === "first") {
        firstWriteStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
    },
  });
  const first = createThreadOrderStore(service("first"));
  const second = createThreadOrderStore(service("second"));
  let firstNotifications = 0;
  let secondNotifications = 0;
  const unsubscribeFirst = first.subscribe(() => {
    firstNotifications += 1;
  });
  const unsubscribeSecond = second.subscribe(() => {
    secondNotifications += 1;
  });

  first.getState().setManualOrder("workspace:shared", ["first-thread"]);
  await firstStarted;
  second.getState().setManualOrder("workspace:shared", ["second-thread"]);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(first.getState().manualOrderByScope, {
    "workspace:shared": ["first-thread"],
  });
  assert.deepEqual(second.getState().manualOrderByScope, {
    "workspace:shared": ["second-thread"],
  });
  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 1);
  assert.equal(writes.first.length, 1);
  assert.equal(writes.second.length, 1);
  assert.ok(releaseFirstWrite);
  releaseFirstWrite();
  await new Promise<void>((resolve) => setImmediate(resolve));

  unsubscribeFirst();
  unsubscribeSecond();
});

test("failed ordering restores the confirmed scope and leaves other scopes intact", async () => {
  const saved = { pinned: ["a", "b"], ungrouped: ["x"] };
  const store = createThreadOrderStore({
    async load() {
      return { sidebarThreadOrderByScope: saved };
    },
    async update() {
      throw new Error("offline");
    },
  });
  await store.getState().hydrate();
  await assert.rejects(store.getState().setManualOrder("pinned", ["b", "a"]), /offline/);
  assert.deepEqual(store.getState().manualOrderByScope, saved);
});

test("an older failed write cannot roll back a newer order or leak into another scope", async () => {
  let saved: Record<string, string[]> = { pinned: ["a", "b"] };
  let writes = 0;
  const store = createThreadOrderStore({
    async load() {
      return { sidebarThreadOrderByScope: saved };
    },
    async update(patch) {
      writes += 1;
      if (writes === 1) throw new Error("offline");
      saved = patch.sidebarThreadOrderByScope!;
    },
  });
  await store.getState().hydrate();
  const first = store.getState().setManualOrder("pinned", ["b", "a"]);
  const firstFailure = assert.rejects(first, /offline/);
  const next = store.getState().setManualOrder("pinned", ["c", "a", "b"]);
  await firstFailure;
  assert.deepEqual(store.getState().manualOrderByScope.pinned, ["c", "a", "b"]);
  await next;
  assert.deepEqual(saved.pinned, ["c", "a", "b"]);

  writes = 0;
  const failed = assert.rejects(
    store.getState().setManualOrder("pinned", ["b", "c", "a"]),
    /offline/,
  );
  const other = store.getState().setManualOrder("ungrouped", ["x"]);
  await Promise.all([failed, other]);
  assert.deepEqual(saved, { pinned: ["c", "a", "b"], ungrouped: ["x"] });
});
