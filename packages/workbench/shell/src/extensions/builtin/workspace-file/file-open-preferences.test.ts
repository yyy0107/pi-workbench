import assert from "node:assert/strict";
import test from "node:test";

import type {
  WorkbenchSettingsPort,
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
} from "@workbench/shell/settings";
import { createFileOpenPreferences, rememberFileOpenApp } from "./file-open-preferences";

test("restores choices and serializes different file types without losing confirmed preferences", async () => {
  let stored: WorkbenchSettingsPreferences = { fileOpenApps: { "extension:html": "firefox" } };
  let fail = false;
  let loads = 0;
  const settings: WorkbenchSettingsPort = {
    load: async () => {
      loads++;
      return stored;
    },
    update: async (patch) => {
      if (fail) throw new Error("offline");
      stored = { ...stored, ...patch } as WorkbenchSettingsPreferences;
    },
  };
  const store = createFileOpenPreferences(settings);
  await Promise.all([store.getState().hydrate(), store.getState().hydrate()]);
  assert.equal(loads, 1);
  assert.equal(store.getState().appIds["extension:html"], "firefox");
  await Promise.all([
    store.getState().remember("extension:pdf", "acrobat"),
    store.getState().remember("extension:png", "gimp"),
    store.getState().remember("browser:extension:html", "firefox"),
  ]);
  fail = true;
  await assert.rejects(store.getState().remember("extension:html", "chrome"), /offline/);
  assert.equal(store.getState().appIds["extension:html"], "firefox");
  fail = false;
  await store.getState().remember("extension:html", "system-default");
  store.dispose();
  const restored = createFileOpenPreferences(settings);
  await restored.getState().hydrate();
  assert.deepEqual(restored.getState().appIds, {
    "extension:html": "system-default",
    "browser:extension:html": "firefox",
    "extension:pdf": "acrobat",
    "extension:png": "gimp",
  });
  restored.dispose();
});

test("retries failed hydration and ignores late responses after disposal", async () => {
  let resolveLoad!: (preferences: WorkbenchSettingsPreferences) => void;
  let attempts = 0;
  const store = createFileOpenPreferences({
    load: () => {
      if (++attempts === 1) return Promise.reject(new Error("offline"));
      return new Promise((resolve) => {
        resolveLoad = resolve;
      });
    },
    update: async () => assert.fail("A disposed preference store must not write"),
  });
  await assert.rejects(store.getState().hydrate(), /offline/);
  assert.equal(store.getState().hydrated, false);
  const hydration = store.getState().hydrate();
  store.dispose();
  resolveLoad({ fileOpenApps: { "extension:html": "chrome" } });
  await hydration;
  await store.getState().remember("extension:pdf", "acrobat");
  assert.deepEqual(store.getState().appIds, {});
});

test("preserves a legacy browser preference before replacing the file application", async () => {
  const writes: WorkbenchSettingsPreferencesPatch[] = [];
  const store = createFileOpenPreferences({
    load: async () => ({ fileOpenApps: { "extension:html": "firefox" } }),
    update: async (patch) => {
      writes.push(patch);
    },
  });
  await store.getState().hydrate();
  await rememberFileOpenApp(store, "extension:html", undefined, [
    { id: "firefox", name: "Firefox", kind: "browser", supportedFileKinds: ["html"] },
  ]);
  assert.deepEqual(writes, [
    { fileOpenApps: { "extension:html": "firefox", "browser:extension:html": "firefox" } },
    { fileOpenApps: { "extension:html": "system-default", "browser:extension:html": "firefox" } },
  ]);
  store.dispose();
});
