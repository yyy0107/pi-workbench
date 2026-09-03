import assert from "node:assert/strict";
import test from "node:test";

import { createPiThreadCancelHandler } from "../../src/assistant-ui/thread-runtime";
import { PiApiError } from "../../src/transport/api";

const errorCopy = {
  sessionBusy: "Busy",
  emptyPrompt: "Empty",
  sessionNotFound: "Missing",
  invalidWorkingDirectory: "Invalid directory",
  invalidWorkspace: "Invalid workspace",
  modelNotAvailable: "Model unavailable",
  requestFailed: "Request failed",
} as const;

test("assistant-ui cancellation delegates exactly once to the authoritative Pi session", async () => {
  let calls = 0;
  const onCancel = createPiThreadCancelHandler(
    {
      async cancel() {
        calls += 1;
      },
    },
    errorCopy,
  );

  await onCancel();

  assert.equal(calls, 1);
});

test("assistant-ui cancellation preserves non-transport errors", async () => {
  const expected = new Error("cancel failed");
  const onCancel = createPiThreadCancelHandler(
    {
      async cancel() {
        throw expected;
      },
    },
    errorCopy,
  );

  await assert.rejects(onCancel, (error) => error === expected);
});

test("assistant-ui cancellation localizes Pi request errors", async () => {
  const onCancel = createPiThreadCancelHandler(
    {
      async cancel() {
        throw new PiApiError("agent-busy", 200);
      },
    },
    errorCopy,
  );

  await assert.rejects(onCancel, { message: "Busy" });
});
