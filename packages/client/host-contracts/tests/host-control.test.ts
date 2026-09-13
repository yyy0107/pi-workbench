import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKBENCH_HOST_CONTROL_VERSION,
  WORKBENCH_HOST_READY_MESSAGE_TYPE,
  WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE,
  createWorkbenchHostReadyMessage,
  createWorkbenchHostShutdownMessage,
  isWorkbenchHostShutdownMessage,
  parseWorkbenchHostReadyMessage,
  parseWorkbenchHostShutdownMessage,
} from "../src/host-control";

test("creates exact immutable credential-free Workbench Host ready messages", () => {
  const ready = createWorkbenchHostReadyMessage({ host: "127.0.0.1", port: 43_127, pid: 4_321 });

  assert.equal(Object.isFrozen(ready), true);
  assert.deepEqual(ready, {
    type: WORKBENCH_HOST_READY_MESSAGE_TYPE,
    version: WORKBENCH_HOST_CONTROL_VERSION,
    host: "127.0.0.1",
    port: 43_127,
    pid: 4_321,
  });
  assert.equal(JSON.stringify(ready).includes("accessToken"), false);
  assert.equal(JSON.stringify(ready).includes("desktop-secret"), false);
});

test("rejects malformed or credential-bearing host control payloads", () => {
  assert.equal(
    parseWorkbenchHostReadyMessage({
      type: WORKBENCH_HOST_READY_MESSAGE_TYPE,
      version: WORKBENCH_HOST_CONTROL_VERSION,
      host: "127.0.0.1",
      port: 43_127,
      pid: 4_321,
      accessToken: "desktop-secret",
    }),
    undefined,
  );
  assert.equal(
    parseWorkbenchHostReadyMessage({
      type: WORKBENCH_HOST_READY_MESSAGE_TYPE,
      version: WORKBENCH_HOST_CONTROL_VERSION,
      host: "127.0.0.1",
      port: 0,
      pid: 4_321,
    }),
    undefined,
  );
  assert.deepEqual(
    parseWorkbenchHostShutdownMessage({ type: WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE }),
    {
      type: WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE,
    },
  );
  const shutdown = createWorkbenchHostShutdownMessage();
  assert.equal(Object.isFrozen(shutdown), true);
  assert.deepEqual(shutdown, { type: WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE });
  assert.equal(
    isWorkbenchHostShutdownMessage({
      type: WORKBENCH_HOST_SHUTDOWN_MESSAGE_TYPE,
      accessToken: "desktop-secret",
    }),
    false,
  );
  assert.throws(
    () =>
      createWorkbenchHostReadyMessage({
        host: "127.0.0.1",
        port: 43_127,
        pid: 4_321,
        accessToken: "desktop-secret",
      } as never),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Invalid Workbench Host ready message." &&
      !error.message.includes("desktop-secret"),
  );
});
