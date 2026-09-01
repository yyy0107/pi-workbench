import assert from "node:assert/strict";
import test from "node:test";

import type {
  WorkbenchSettingsPort,
  WorkbenchSettingsPreferencesPatch,
} from "@workbench/agent-runtime-contracts/settings";

import {
  createRightWorkspacePersistence,
  RIGHT_WORKSPACE_LEGACY_STORAGE_KEY,
  type RightWorkspaceLegacyStorage,
} from "./right-workspace-persistence";

class MemoryLegacyStorage implements RightWorkspaceLegacyStorage {
  readonly values = new Map<string, string>();
  readonly removed: string[] = [];

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.removed.push(key);
    this.values.delete(key);
  }
}

function createSettings(
  load: WorkbenchSettingsPort["load"],
  update: WorkbenchSettingsPort["update"],
): WorkbenchSettingsPort {
  return { load, update };
}

test("settings stays authoritative while a leftover legacy value is tracked for cleanup", async () => {
  let legacyReads = 0;
  let legacyRemovals = 0;
  const persistence = createRightWorkspacePersistence({
    settings: createSettings(
      async () => ({ rightWorkspace: { open: true, width: 640 } }),
      async () => undefined,
    ),
    legacyStorage: {
      getItem() {
        legacyReads += 1;
        return '{"open":false}';
      },
      removeItem() {
        legacyRemovals += 1;
      },
    },
  });

  assert.deepEqual(JSON.parse((await persistence.read()) ?? "null"), {
    open: true,
    width: 640,
  });
  assert.equal(legacyReads, 1);
  await persistence.write('{"open":true,"width":640}');
  assert.equal(legacyRemovals, 1);
});

test("a new persistence instance retries legacy cleanup after an earlier removal failure", async () => {
  const legacyStorage = new MemoryLegacyStorage();
  legacyStorage.values.set(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY, '{"open":false}');
  let preferences: Awaited<ReturnType<WorkbenchSettingsPort["load"]>> = {};
  let failRemoval = true;
  const storage: RightWorkspaceLegacyStorage = {
    getItem: (key) => legacyStorage.getItem(key),
    removeItem(key) {
      if (failRemoval) throw new Error("storage temporarily unavailable");
      legacyStorage.removeItem(key);
    },
  };
  const settings = createSettings(
    async () => preferences,
    async (patch) => {
      preferences = {
        ...preferences,
        ...(patch.rightWorkspace === null
          ? { rightWorkspace: undefined }
          : patch.rightWorkspace === undefined
            ? {}
            : { rightWorkspace: patch.rightWorkspace }),
      };
    },
  );

  const first = createRightWorkspacePersistence({ settings, legacyStorage: storage });
  assert.equal(await first.read(), '{"open":false}');
  await first.write('{"open":true}');
  assert.equal(legacyStorage.values.has(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY), true);

  failRemoval = false;
  const second = createRightWorkspacePersistence({ settings, legacyStorage: storage });
  assert.equal(await second.read(), '{"open":true}');
  await second.write('{"open":true}');
  assert.equal(legacyStorage.values.has(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY), false);
  assert.deepEqual(legacyStorage.removed, [RIGHT_WORKSPACE_LEGACY_STORAGE_KEY]);
});

test("reading legacy is side-effect free and the first successful normalized write removes it", async () => {
  const legacyStorage = new MemoryLegacyStorage();
  legacyStorage.values.set(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY, '{"open":true}');
  const updates: WorkbenchSettingsPreferencesPatch[] = [];
  const persistence = createRightWorkspacePersistence({
    settings: createSettings(
      async () => ({}),
      async (patch) => {
        updates.push(patch);
      },
    ),
    legacyStorage,
  });

  assert.equal(await persistence.read(), '{"open":true}');
  assert.equal(updates.length, 0);
  assert.deepEqual(legacyStorage.removed, []);

  await persistence.write('{"open":true,"surfaceOrder":[],"surfaces":[]}');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    rightWorkspace: { open: true, surfaceOrder: [], surfaces: [] },
  });
  assert.deepEqual(legacyStorage.removed, [RIGHT_WORKSPACE_LEGACY_STORAGE_KEY]);
});

test("a failed normalized settings write retains the legacy payload", async () => {
  const legacyStorage = new MemoryLegacyStorage();
  legacyStorage.values.set(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY, '{"open":true}');
  const persistence = createRightWorkspacePersistence({
    settings: createSettings(
      async () => ({}),
      async () => {
        throw new Error("update failed");
      },
    ),
    legacyStorage,
  });

  await persistence.read();
  await assert.rejects(() => persistence.write('{"open":true}'), /update failed/);
  assert.equal(legacyStorage.values.has(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY), true);
  assert.deepEqual(legacyStorage.removed, []);
});

test("a settings load failure preserves valid legacy without treating it as authoritative", async () => {
  const legacyStorage = new MemoryLegacyStorage();
  legacyStorage.values.set(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY, '{"open":true}');
  const updates: WorkbenchSettingsPreferencesPatch[] = [];
  const persistence = createRightWorkspacePersistence({
    settings: createSettings(
      async () => {
        throw new Error("load failed");
      },
      async (patch) => {
        updates.push(patch);
      },
    ),
    legacyStorage,
  });

  await assert.rejects(() => persistence.read(), /load failed/);
  assert.equal(updates.length, 0);
  assert.equal(legacyStorage.values.has(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY), true);
});

test("unknown remote data rejects read when no legacy fallback exists", async () => {
  let updates = 0;
  const persistence = createRightWorkspacePersistence({
    settings: createSettings(
      async () => {
        throw new Error("load failed");
      },
      async () => {
        updates += 1;
      },
    ),
    legacyStorage: new MemoryLegacyStorage(),
  });

  await assert.rejects(() => persistence.read(), /load failed/);
  assert.equal(updates, 0);
});

test("unknown remote data is not overwritten from a malformed legacy fallback", async () => {
  const legacyStorage = new MemoryLegacyStorage();
  legacyStorage.values.set(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY, "{");
  let updates = 0;
  const persistence = createRightWorkspacePersistence({
    settings: createSettings(
      async () => {
        throw new Error("load failed");
      },
      async () => {
        updates += 1;
      },
    ),
    legacyStorage,
  });

  await assert.rejects(() => persistence.read(), /load failed/);
  assert.equal(updates, 0);
  assert.equal(legacyStorage.values.has(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY), true);
});

test("legacy storage failures do not hide a definitive settings result", async () => {
  const persistence = createRightWorkspacePersistence({
    settings: createSettings(
      async () => ({}),
      async () => undefined,
    ),
    legacyStorage: {
      getItem() {
        throw new Error("storage disabled");
      },
      removeItem() {},
    },
  });

  assert.equal(await persistence.read(), null);
});

test("the opaque bridge refuses non-object payloads without updating settings", async () => {
  let updates = 0;
  const persistence = createRightWorkspacePersistence({
    settings: createSettings(
      async () => ({}),
      async () => {
        updates += 1;
      },
    ),
    legacyStorage: new MemoryLegacyStorage(),
  });

  await assert.rejects(() => persistence.write("[]"), /JSON object/);
  await assert.rejects(() => persistence.write("not-json"));
  assert.equal(updates, 0);
});
