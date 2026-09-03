import assert from "node:assert/strict";
import test from "node:test";

import type { CompiledComposerRequest } from "@workbench/extension-sdk";

import { submitWorkbenchComposer } from "./composer-submit";

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
