import assert from "node:assert/strict";
import test from "node:test";

import { submitWorkbenchComposer, type ComposerSubmitThread } from "./composer-submit";

function submitHarness({
  canSend,
  text = "",
  isRunning = false,
  canQueue = false,
}: {
  canSend: boolean;
  text?: string;
  isRunning?: boolean;
  canQueue?: boolean;
}) {
  const sends: Array<{ steer?: boolean } | undefined> = [];
  let composerText = text;
  let composerCanSend = canSend;
  let runConfig: { custom?: Record<string, unknown> } = {};
  const thread: ComposerSubmitThread = {
    getState: () => ({ isRunning, capabilities: { queue: canQueue } }),
    composer: () => ({
      getState: () => ({ canSend: composerCanSend, text: composerText, runConfig }),
      setText: (nextText) => {
        composerText = nextText;
        composerCanSend = nextText.length > 0;
      },
      setRunConfig: (nextRunConfig) => {
        runConfig = nextRunConfig;
      },
      send: (options) => sends.push(options),
    }),
  };

  return { getRunConfig: () => runConfig, getText: () => composerText, sends, thread };
}

test("submits from the live composer state even when the previous render was disabled", () => {
  const { sends, thread } = submitHarness({ canSend: true });

  assert.equal(submitWorkbenchComposer(thread), true);
  assert.deepEqual(sends, [undefined]);
});

test("synchronizes the final textarea value before checking whether the composer can send", () => {
  const { getText, sends, thread } = submitHarness({ canSend: false });

  assert.equal(submitWorkbenchComposer(thread, "typed immediately before Enter"), true);
  assert.equal(getText(), "typed immediately before Enter");
  assert.deepEqual(sends, [undefined]);
});

test("stores a compiled composer request in runConfig before sending", () => {
  const { getRunConfig, sends, thread } = submitHarness({ canSend: true });
  const request = {
    version: 1 as const,
    document: [],
    sourceText: "compiled",
    text: "compiled",
    context: [],
    metadata: {},
    commands: [],
  };

  assert.equal(submitWorkbenchComposer(thread, undefined, request), true);
  assert.deepEqual(getRunConfig().custom?.workbenchComposer, request);
  assert.deepEqual(sends, [undefined]);
});

test("does not dispatch an empty or otherwise blocked composer", () => {
  const { sends, thread } = submitHarness({ canSend: false });

  assert.equal(submitWorkbenchComposer(thread), false);
  assert.deepEqual(sends, []);
});

test("uses follow-up queue semantics while the thread is running", () => {
  const { sends, thread } = submitHarness({ canSend: true, isRunning: true, canQueue: true });

  assert.equal(submitWorkbenchComposer(thread), true);
  assert.deepEqual(sends, [{ steer: false }]);
});

test("uses steering semantics when requested while the thread is running", () => {
  const { sends, thread } = submitHarness({ canSend: true, isRunning: true, canQueue: true });

  assert.equal(submitWorkbenchComposer(thread, undefined, undefined, { steer: true }), true);
  assert.deepEqual(sends, [{ steer: true }]);
});
