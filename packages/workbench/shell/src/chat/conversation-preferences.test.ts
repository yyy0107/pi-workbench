import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchSettingsPreferences } from "../settings";
import { createConversationPreferences } from "./conversation-preferences";

test("restores conversation preferences, persists edits, and keeps confirmed values on failure", async () => {
  let stored: WorkbenchSettingsPreferences = { runningMessageMode: "steer", showReasoning: false };
  let fail = false;
  const store = createConversationPreferences({
    load: async () => stored,
    update: async (patch) => {
      if (fail) throw new Error("offline");
      stored = { ...stored, ...patch } as WorkbenchSettingsPreferences;
    },
  });
  await Promise.all([store.getState().hydrate(), store.getState().hydrate()]);
  assert.deepEqual(store.getState().preferences, {
    runningMessageMode: "steer",
    showReasoning: false,
    groupParallelTools: true,
    enhancedSearch: false,
    askUserAutoContinue: true,
    retainAllModelIO: false,
    showTodos: true,
    groupExplorationTools: true,
    groupTerminalTools: true,
    groupFileChanges: false,
  });
  await store.getState().update({ groupParallelTools: false });
  assert.equal(stored.groupParallelTools, false);
  fail = true;
  await store.getState().update({ showReasoning: true });
  assert.equal(store.getState().preferences.showReasoning, false);
  assert.equal(store.getState().saveFailed, true);
  assert.equal(store.getState().status, "ready");
  store.dispose();
});

test("retries failed hydration and ignores a response after installation disposal", async () => {
  let fail = true;
  const store = createConversationPreferences({
    load: async () => {
      if (fail) throw new Error("offline");
      return { showReasoning: false };
    },
    update: async () => {},
  });
  await store.getState().hydrate();
  assert.equal(store.getState().status, "error");
  fail = false;
  const task = store.getState().hydrate();
  store.dispose();
  await task;
  assert.equal(store.getState().preferences.showReasoning, true);
});
