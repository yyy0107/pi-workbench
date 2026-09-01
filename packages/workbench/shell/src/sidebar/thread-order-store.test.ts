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
