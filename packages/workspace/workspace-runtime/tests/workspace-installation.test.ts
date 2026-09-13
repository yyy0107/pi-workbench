import assert from "node:assert/strict";
import test from "node:test";

import type { LocalizableText } from "@workbench/extension-sdk";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";

import { createRightWorkspaceInstallation } from "../src/workspace-installation";

const validateLocalizableText = (candidate: unknown): candidate is LocalizableText =>
  typeof candidate === "string";

function createOpener() {
  return Object.freeze({
    open: async () => undefined,
    getHandlers: () => [],
    subscribe: () => () => undefined,
  });
}

function flushPersistence(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a headless installation owns one state graph and gates persistence through disposal", async () => {
  let resolveRead!: (value: string | null) => void;
  const writes: string[] = [];
  const installation = createRightWorkspaceInstallation({
    createOpener,
    initialContext: { applicationId: "headless-fixture" },
    persistence: {
      read: () => new Promise((resolve) => (resolveRead = resolve)),
      write: async (serialized) => {
        writes.push(serialized);
      },
    },
    registry: new WorkspaceSurfaceRegistryImpl(),
    validateLocalizableText,
  });

  assert.strictEqual(installation.resolveDraftStore(), installation.resolveDraftStore());
  assert.equal("setState" in installation.store, false);
  assert.equal("destroy" in installation.store, false);

  installation.activatePersistence();
  const initialization = installation.controller.initialize();
  resolveRead(null);
  await initialization;
  const initializedWriteCount = writes.length;
  installation.controller.setWidth(640);
  await flushPersistence();
  assert.equal(writes.length, initializedWriteCount + 1);

  installation.deactivatePersistence();
  installation.controller.setWidth(680);
  await flushPersistence();
  assert.equal(writes.length, initializedWriteCount + 1);

  installation.dispose();
  installation.dispose();
  assert.throws(() => installation.controller.setWidth(700), /disposed/);
  assert.throws(() => installation.feedback.add({} as never), /disposed/);
  assert.throws(() => installation.resolveDraftStore(), /disposed/);
  assert.equal(installation.store.getState().width, 680);
  assert.equal(writes.length, initializedWriteCount + 1);
});

test("disposing a headless installation invalidates late hydration without reopening writes", async () => {
  let resolveRead!: (value: string | null) => void;
  const writes: string[] = [];
  const installation = createRightWorkspaceInstallation({
    createOpener,
    initialContext: { applicationId: "late-fixture" },
    persistence: {
      read: () => new Promise((resolve) => (resolveRead = resolve)),
      write: async (serialized) => {
        writes.push(serialized);
      },
    },
    registry: new WorkspaceSurfaceRegistryImpl(),
    validateLocalizableText,
  });

  installation.activatePersistence();
  const initialization = installation.controller.initialize();
  installation.dispose();
  resolveRead(JSON.stringify({ open: true, width: 720, surfaceOrder: [], surfaces: [] }));
  await initialization;
  await flushPersistence();

  assert.equal(installation.store.getState().open, false);
  assert.equal(writes.length, 0);
  assert.throws(() => installation.controller.setWorkspaceOpen(true), /disposed/);
});
