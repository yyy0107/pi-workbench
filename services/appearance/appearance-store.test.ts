import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  isDefaultAppearancePreferences,
} from "./appearance-preferences";
import { appearanceStore } from "./appearance-store";

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

  let notificationCount = 0;
  const unsubscribe = appearanceStore.subscribe(() => {
    notificationCount += 1;
  });

  try {
    appearanceStore.hydrate();
    assert.equal(appearanceStore.getSnapshot().colorMode, "dark");
    assert.equal(notificationCount, 1);

    appearanceStore.update({ codeTheme: "dracula" });
    assert.equal(appearanceStore.getSnapshot().codeTheme, "dracula");
    assert.equal(writes.length, 0);

    appearanceStore.sync(JSON.stringify({ codeTheme: "nord" }));
    assert.equal(appearanceStore.getSnapshot().codeTheme, "nord");
    assert.equal(writes.length, 0);

    appearanceStore.reset();
    assert.equal(appearanceStore.getSnapshot(), DEFAULT_APPEARANCE_PREFERENCES);
    assert.equal(isDefaultAppearancePreferences(appearanceStore.getSnapshot()), true);
    assert.deepEqual(removals, [APPEARANCE_STORAGE_KEY]);
    assert.equal(notificationCount, 4);
  } finally {
    unsubscribe();
    appearanceStore.reset();
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
