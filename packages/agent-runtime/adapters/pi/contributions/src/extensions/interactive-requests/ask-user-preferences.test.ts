import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_USER_PREFERENCES_STORAGE_KEY,
  createAskUserPreferences,
  parseAskUserEnabled,
} from "./ask-user-preferences";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function withLocalStorage<T>(
  localStorage: { getItem(key: string): string | null; removeItem(key: string): void },
  run: () => Promise<T>,
): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("parses the persisted Ask User capability preference defensively", () => {
  assert.equal(parseAskUserEnabled(null), true);
  assert.equal(parseAskUserEnabled('{"enabled":true}'), true);
  assert.equal(parseAskUserEnabled('{"enabled":false}'), false);
  assert.equal(parseAskUserEnabled('{"enabled":"false"}'), true);
  assert.equal(parseAskUserEnabled("not-json"), true);
});

test("does not migrate, clean up, or notify after a disposed installation resolves hydration", async () => {
  const load = deferred<Record<string, never>>();
  const writes: unknown[] = [];
  const removed: string[] = [];

  await withLocalStorage(
    {
      getItem: (key) => (key === ASK_USER_PREFERENCES_STORAGE_KEY ? '{"enabled":false}' : null),
      removeItem: (key) => void removed.push(key),
    },
    async () => {
      const preferences = createAskUserPreferences({
        load: () => load.promise,
        update: async (patch) => void writes.push(patch),
      });
      let notifications = 0;
      preferences.subscribe(() => {
        notifications += 1;
      });

      const hydration = preferences.hydrate();
      preferences.dispose();
      load.resolve({});
      await hydration;

      assert.deepEqual(writes, []);
      assert.deepEqual(removed, []);
      assert.equal(notifications, 0);
      assert.equal(preferences.getSnapshot().status, "loading");
    },
  );
});
