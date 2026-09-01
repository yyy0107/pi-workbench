import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceDraftStore,
  type RightWorkspaceDraftPersistencePort,
} from "./workspace-draft-store";

test("workspace draft stores cache an app port and stop external writes after disposal", () => {
  const persisted = new Map<string, string>([["existing", "persisted"]]);
  const writes: string[] = [];
  const persistence: RightWorkspaceDraftPersistencePort = {
    getItem(key) {
      return persisted.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push(`set:${key}:${value}`);
      persisted.set(key, value);
    },
    removeItem(key) {
      writes.push(`remove:${key}`);
      persisted.delete(key);
    },
  };
  const store = createWorkspaceDraftStore(persistence);

  assert.equal(store.getItem("existing"), "persisted");
  store.setItem("draft", "value");
  store.removeItem("existing");
  assert.deepEqual(writes, ["set:draft:value", "remove:existing"]);
  assert.equal(store.getItem("draft"), "value");

  store.dispose();
  store.setItem("late", "ignored");
  store.removeItem("draft");
  assert.equal(store.getItem("draft"), null);
  assert.deepEqual(writes, ["set:draft:value", "remove:existing"]);
});
