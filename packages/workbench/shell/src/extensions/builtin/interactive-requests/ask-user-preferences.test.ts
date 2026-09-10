import assert from "node:assert/strict";
import test from "node:test";

import { createToolCapabilityPreferences } from "../../../tool-capability-preferences";

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
  assert.equal(parseAskUserEnabled(null), false);
  assert.equal(parseAskUserEnabled('{"enabled":true}'), true);
  assert.equal(parseAskUserEnabled('{"enabled":false}'), false);
  assert.equal(parseAskUserEnabled('{"enabled":"false"}'), false);
  assert.equal(parseAskUserEnabled("not-json"), false);
});

test("opt-in tools start disabled and respect saved choices after hydration", async () => {
  for (const key of ["todoEnabled", "askUserEnabled", "workbenchSettingsEnabled"] as const) {
    for (const saved of [undefined, false, true, "read-error"] as const) {
      const preferences = createToolCapabilityPreferences(
        {
          load: async () => {
            if (saved === "read-error") throw new Error("Settings unavailable");
            return { [key]: saved };
          },
          update: async () => {},
        },
        key,
      );
      assert.equal(preferences.getSnapshot().enabled, false);
      assert.equal(preferences.getServerSnapshot().enabled, false);
      await preferences.hydrate();
      assert.equal(preferences.getSnapshot().enabled, saved === true);
      preferences.dispose();
    }
  }
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

test("tool preferences stay independent, preserve Ask User migration and roll back failed saves", async () => {
  const writes: unknown[] = [];
  const removed: string[] = [];
  let fail = false;
  await withLocalStorage(
    {
      getItem: () => '{"enabled":false}',
      removeItem: (key) => {
        removed.push(key);
      },
    },
    async () => {
      const settings = {
        load: async () => ({}),
        update: async (patch: unknown) => {
          if (fail) throw new Error("save failed");
          writes.push(patch);
        },
      };
      const todo = createToolCapabilityPreferences(settings, "todoEnabled");
      const ask = createAskUserPreferences(settings);
      await todo.hydrate();
      assert.equal(todo.getSnapshot().enabled, false);
      assert.deepEqual(writes, []);
      assert.deepEqual(removed, []);
      await ask.hydrate();
      assert.equal(ask.getSnapshot().enabled, false);
      assert.deepEqual(writes, [{ askUserEnabled: false }]);
      let notifications = 0;
      todo.subscribe(() => {
        notifications += 1;
      });
      await todo.setEnabled(true);
      assert.equal(todo.getSnapshot().enabled, true);
      assert.deepEqual(writes, [{ askUserEnabled: false }, { todoEnabled: true }]);
      assert.equal(removed.length, 1);
      assert.equal(notifications, 2);
      fail = true;
      await assert.rejects(todo.setEnabled(false), /save failed/);
      assert.deepEqual(todo.getSnapshot(), { enabled: true, status: "ready", saveFailed: true });
      assert.equal(ask.getSnapshot().enabled, false);
      todo.dispose();
      ask.dispose();
    },
  );
});

test("native tool preferences preserve explicit choices over enhanced-search defaults", async () => {
  const patches: unknown[] = [];
  const grep = createToolCapabilityPreferences(
    {
      load: async () => ({ enhancedSearch: true, grepToolEnabled: false }),
      update: async (patch) => {
        patches.push(patch);
      },
    },
    "grepToolEnabled",
  );
  await grep.hydrate();
  assert.equal(grep.getSnapshot().enabled, false);
  await grep.setEnabled(true);
  assert.deepEqual(patches, [{ grepToolEnabled: true }]);
  assert.equal(grep.getSnapshot().enabled, true);
  grep.dispose();
});

test("enhanced search restores the existing setting and only persists its own preference", async () => {
  const patches: unknown[] = [];
  let fail = false;
  const search = createToolCapabilityPreferences(
    {
      load: async () => ({ enhancedSearch: true, findToolEnabled: false }),
      update: async (patch) => {
        if (fail) throw new Error("offline");
        patches.push(patch);
      },
    },
    "enhancedSearch",
  );
  await search.hydrate();
  assert.equal(search.getSnapshot().enabled, true);
  await search.setEnabled(false);
  assert.deepEqual(patches, [{ enhancedSearch: false }]);
  fail = true;
  await assert.rejects(search.setEnabled(true), /offline/);
  assert.deepEqual(search.getSnapshot(), { enabled: false, status: "ready", saveFailed: true });
  search.dispose();
});
