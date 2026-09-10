import assert from "node:assert/strict";
import test from "node:test";

import type { CompiledComposerRequest } from "@workbench/extension-sdk";

import {
  canSubmitWorkbenchComposer,
  runningComposerMode,
  submitWorkbenchComposer,
} from "./composer-submit";

test("submission requires workspace and model readiness and recovers after selection", () => {
  let modelReady = false;
  const guard = () => modelReady;
  const guards = new Set([guard]);
  assert.equal(canSubmitWorkbenchComposer(false, guards), false);
  assert.equal(canSubmitWorkbenchComposer(true, guards), false);
  modelReady = true;
  assert.equal(canSubmitWorkbenchComposer(false, guards), false);
  assert.equal(canSubmitWorkbenchComposer(true, guards), true);
  modelReady = false;
  assert.equal(canSubmitWorkbenchComposer(true, guards), false);
  guards.delete(guard);
  assert.equal(canSubmitWorkbenchComposer(true, guards), true);
});

const request: CompiledComposerRequest = {
  version: 2,
  document: [],
  sourceText: "compiled",
  text: "compiled",
  context: [],
  metadata: {},
  commands: [],
};

function submitHarness(
  isRunning: boolean,
  actions: Record<string, (input: unknown) => Promise<void>>,
) {
  return {
    snapshot: { getSnapshot: () => ({ isRunning }) },
    actions,
  };
}

test("selects send, queue, and steer from the live Session snapshot", async () => {
  const calls: string[] = [];
  const actions = Object.fromEntries(
    ["send", "queue", "steer"].map((name) => [
      name,
      async () => {
        calls.push(name);
      },
    ]),
  );

  assert.equal(await submitWorkbenchComposer(submitHarness(false, actions), request), true);
  assert.equal(await submitWorkbenchComposer(submitHarness(true, actions), request), true);
  assert.equal(
    await submitWorkbenchComposer(submitHarness(true, actions), request, { steer: true }),
    true,
  );
  assert.deepEqual(calls, ["send", "queue", "steer"]);
});

test("reports an unavailable runtime capability without dispatching", async () => {
  assert.equal(await submitWorkbenchComposer(submitHarness(true, {}), request), false);
});

test("the modifier inverts either follow-up preference for one message and leaves idle sends unchanged", async () => {
  const calls: string[] = [];
  const actions = Object.fromEntries(
    ["send", "queue", "steer"].map((mode) => [
      mode,
      async () => {
        calls.push(mode);
      },
    ]),
  );
  for (const preferred of ["queue", "steer"] as const) {
    for (const invert of [false, true, false]) {
      const mode = runningComposerMode(actions, preferred, invert);
      await submitWorkbenchComposer(submitHarness(true, actions), request, {
        steer: mode === "steer",
      });
    }
    const oppositeMode = runningComposerMode(actions, preferred, true);
    await submitWorkbenchComposer(submitHarness(false, actions), request, {
      steer: oppositeMode === "steer",
    });
  }
  assert.deepEqual(calls, ["queue", "steer", "queue", "send", "steer", "queue", "steer", "send"]);
});

test("uses the preferred running action and falls back when that capability is unavailable", async () => {
  const calls: string[] = [];
  const queue = async () => {
    calls.push("queue");
  };
  const steer = async () => {
    calls.push("steer");
  };
  for (const [actions, preferred, expected] of [
    [{ queue, steer }, "steer", "steer"],
    [{ queue, steer }, "queue", "queue"],
    [{ queue }, "steer", "queue"],
    [{ steer }, "queue", "steer"],
  ] as const) {
    const mode = runningComposerMode(actions, preferred);
    assert.equal(mode, expected);
    await submitWorkbenchComposer(submitHarness(true, actions), request, {
      steer: mode === "steer",
    });
  }
  assert.deepEqual(calls, ["steer", "queue", "queue", "steer"]);
});
