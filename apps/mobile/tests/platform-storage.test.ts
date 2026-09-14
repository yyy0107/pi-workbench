import assert from "node:assert/strict";
import test from "node:test";

import { createMobileSecureStore } from "../src/platform/secure-store.ts";
import { openMobileDatabase } from "../src/platform/sqlite.ts";

test("stores each computer's direct private keys under a separate device-only secure key", async () => {
  const values = new Map<string, string>();
  const indexed = new Set<string>();
  const secureStore = createMobileSecureStore({
    index: {
      list: async () => [...indexed],
      add: async (key) => void indexed.add(key),
      remove: async (key) => void indexed.delete(key),
      clear: async () => void indexed.clear(),
    },
    loadModule: async () =>
      ({
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
        isAvailableAsync: async () => true,
        setItemAsync: async (key: string, value: string, options: unknown) => {
          assert.deepEqual(options, {
            keychainAccessible: 7,
            keychainService: "com.piworkbench.remote.credentials",
          });
          values.set(key, value);
        },
        getItemAsync: async (key: string) => values.get(key) ?? null,
        deleteItemAsync: async (key: string) => void values.delete(key),
      }) as never,
  });

  await secureStore.saveMachineKeys("machine/一", { key: "machine-secret" });
  await secureStore.saveMachineKeys("machine/two", { key: "other-secret" });
  assert.equal(values.size, 3);
  assert.deepEqual(await secureStore.loadMachineKeys("machine/一"), {
    key: "machine-secret",
  });
  await secureStore.clearMachine("machine/一");
  assert.equal(values.size, 2);
  assert.deepEqual(await secureStore.loadMachineKeys("machine/two"), {
    key: "other-secret",
  });
  await secureStore.clearAll();
  assert.equal(values.size, 0);
  assert.equal(indexed.size, 0);
});

test("clears machine credentials after SQLite state is lost during reinstall", async () => {
  const values = new Map<string, string>();
  const module = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    isAvailableAsync: async () => true,
    setItemAsync: async (key: string, value: string) => void values.set(key, value),
    getItemAsync: async (key: string) => values.get(key) ?? null,
    deleteItemAsync: async (key: string) => void values.delete(key),
  } as never;
  const createEmptyIndex = () => ({
    list: async (): Promise<readonly string[]> => [],
    add: async () => {},
    remove: async () => {},
    clear: async () => {},
  });
  const beforeReinstall = createMobileSecureStore({
    index: createEmptyIndex(),
    loadModule: async () => module,
  });
  await beforeReinstall.saveMachineKeys("machine-survives-sqlite", {
    key: "must-be-cleared",
  });

  const afterReinstall = createMobileSecureStore({
    index: createEmptyIndex(),
    loadModule: async () => module,
  });
  await afterReinstall.clearAll();
  assert.equal(values.size, 0);
});

test("enables WAL and migrations while binding every mutable SQLite value", async () => {
  const exec: string[] = [];
  const runs: Array<{ sql: string; params: readonly unknown[] }> = [];
  const database = {
    closeAsync: async () => {},
    execAsync: async (sql: string) => void exec.push(sql),
    getFirstAsync: async (sql: string) => {
      if (sql === "PRAGMA user_version") return { user_version: 0 };
      return null;
    },
    getAllAsync: async () => [{ item_key: "secure-key-1" }],
    runAsync: async (sql: string, params: readonly unknown[]) => {
      runs.push({ sql, params });
      return {};
    },
    withExclusiveTransactionAsync: async (operation: (transaction: unknown) => Promise<void>) =>
      operation(database),
  };
  const storage = await openMobileDatabase({
    loadModule: async () => ({ openDatabaseAsync: async () => database }) as never,
  });
  assert.match(exec[0] ?? "", /journal_mode = WAL/u);
  assert.match(exec[1] ?? "", /CREATE TABLE IF NOT EXISTS installation_state/u);
  assert.match(exec[2] ?? "", /CREATE TABLE IF NOT EXISTS conversation_cache/u);
  assert.match(exec[3] ?? "", /CREATE TABLE IF NOT EXISTS session_local_state/u);
  assert.match(exec[4] ?? "", /PRAGMA user_version = 4/u);
  assert.match(exec[5] ?? "", /CREATE TABLE IF NOT EXISTS projection_cursor/u);
  assert.match(exec[6] ?? "", /CREATE TABLE IF NOT EXISTS direct_connection_profiles/u);
  assert.match(exec[6] ?? "", /DROP TABLE IF EXISTS notification_registration_state/u);

  await storage.sentinel.create();
  await storage.secureItemIndex.add("secure-key-2");
  await storage.projection.clearMachine("machine-1");
  assert.deepEqual(
    runs.filter((call) => call.sql.includes("machine_id = ?")).map((call) => call.params),
    [
      ["machine-1"],
      ["machine-1"],
      ["machine-1"],
      ["machine-1"],
      ["machine-1"],
      ["machine-1"],
      ["machine-1"],
    ],
  );
  assert.equal(
    runs.some((call) => call.sql.includes("machine-1")),
    false,
  );
  assert.deepEqual(await storage.secureItemIndex.list(), ["secure-key-1"]);
});
