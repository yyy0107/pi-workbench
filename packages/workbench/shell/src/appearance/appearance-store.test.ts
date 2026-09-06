import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  isDefaultAppearancePreferences,
} from "./appearance-preferences";
import { createAppearanceStore } from "./appearance-store";
import type { WorkbenchSettingsPreferencesPatch, WorkbenchSettingsPort } from "../settings";

test("hydrates legacy browser preferences without writing new browser state", () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storageValues = new Map<string, string>([
    [APPEARANCE_STORAGE_KEY, JSON.stringify({ colorMode: "dark" })],
  ]);
  const writes: Array<readonly [string, string]> = [];
  const removals: string[] = [];
  const localStorage = {
    getItem(key: string): string | null {
      return storageValues.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      writes.push([key, value]);
      storageValues.set(key, value);
    },
    removeItem(key: string): void {
      removals.push(key);
      storageValues.delete(key);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  const updates: WorkbenchSettingsPreferencesPatch[] = [];
  const settings: WorkbenchSettingsPort = {
    async load() {
      return {};
    },
    async update(patch) {
      updates.push(patch);
    },
  };
  const appearanceStore = createAppearanceStore(settings);

  let notificationCount = 0;
  const unsubscribe = appearanceStore.subscribe(() => {
    notificationCount += 1;
  });

  try {
    appearanceStore.hydrate();
    assert.equal(appearanceStore.getSnapshot().colorMode, "dark");
    assert.equal(notificationCount, 1);

    appearanceStore.update({ codeTheme: "dracula", surfaceColorBlend: 65 });
    assert.equal(appearanceStore.getSnapshot().codeTheme, "dracula");
    assert.equal(appearanceStore.getSnapshot().surfaceColorBlend, 65);
    assert.equal(updates.at(-1)?.appearance?.surfaceColorBlend, 65);
    assert.equal(writes.length, 0);

    appearanceStore.sync(JSON.stringify({ codeTheme: "nord", surfaceColorBlend: 35 }));
    assert.equal(appearanceStore.getSnapshot().codeTheme, "nord");
    assert.equal(appearanceStore.getSnapshot().surfaceColorBlend, 35);
    assert.equal(writes.length, 0);

    appearanceStore.reset();
    assert.deepEqual(updates.at(-1), { appearance: null });
    assert.equal(appearanceStore.getSnapshot(), DEFAULT_APPEARANCE_PREFERENCES);
    assert.equal(isDefaultAppearancePreferences(appearanceStore.getSnapshot()), true);
    assert.deepEqual(removals, [APPEARANCE_STORAGE_KEY]);
    assert.equal(notificationCount, 4);
  } finally {
    unsubscribe();
    appearanceStore.dispose();
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("disposal prevents late appearance hydration writes, cleanup, and notifications", async () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const removals: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem() {
          return JSON.stringify({ colorMode: "dark" });
        },
        removeItem(key: string) {
          removals.push(key);
        },
      },
    },
  });

  let resolveLoad!: (preferences: Awaited<ReturnType<WorkbenchSettingsPort["load"]>>) => void;
  const deferredLoad = new Promise<Awaited<ReturnType<WorkbenchSettingsPort["load"]>>>(
    (resolve) => {
      resolveLoad = resolve;
    },
  );
  const updates: WorkbenchSettingsPreferencesPatch[] = [];
  const settings: WorkbenchSettingsPort = {
    load() {
      return deferredLoad;
    },
    async update(patch) {
      updates.push(patch);
    },
  };
  const appearanceStore = createAppearanceStore(settings);
  let notifications = 0;
  appearanceStore.subscribe(() => {
    notifications += 1;
  });

  try {
    appearanceStore.hydrate();
    assert.equal(notifications, 1);
    appearanceStore.dispose();
    resolveLoad({});
    await deferredLoad;
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(updates, []);
    assert.deepEqual(removals, []);
    assert.equal(notifications, 1);
    appearanceStore.update({ colorMode: "light" });
    appearanceStore.reset();
    appearanceStore.sync(JSON.stringify({ colorMode: "system" }));
    assert.deepEqual(updates, []);
    assert.deepEqual(removals, []);
    assert.equal(notifications, 1);
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
