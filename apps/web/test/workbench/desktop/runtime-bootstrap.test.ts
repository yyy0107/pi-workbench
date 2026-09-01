import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
} from "@workbench/host-contracts";

import { readWorkbenchDesktopRuntimeConnection } from "@/workbench/desktop/runtime-bootstrap";

test("selects and validates the trusted desktop sidecar bootstrap connection", () => {
  let calls = 0;
  const connection = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "http://127.0.0.1:43202",
    instanceId: "runtime-instance",
    accessToken: "runtime-secret-token",
  });
  const selected = readWorkbenchDesktopRuntimeConnection({
    runtime: {
      bootstrap() {
        calls += 1;
        return connection;
      },
    },
  });

  assert.deepEqual(selected, connection);
  assert.equal(calls, 1);
  assert.equal(selected?.httpOrigin, "http://127.0.0.1:43202");
  assert.equal(selected?.httpOrigin.includes("runtime-secret-token"), false);
});

test("accepts explicit development same-origin bootstrap and fails closed on invalid values", () => {
  assert.equal(readWorkbenchDesktopRuntimeConnection(undefined), undefined);
  assert.deepEqual(
    readWorkbenchDesktopRuntimeConnection({
      runtime: {
        bootstrap: () => ({
          kind: "same-origin",
          protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
          httpOrigin: "http://127.0.0.1:43201",
        }),
      },
    }),
    {
      kind: "same-origin",
      protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
      httpOrigin: "http://127.0.0.1:43201",
    },
  );
  assert.throws(
    () =>
      readWorkbenchDesktopRuntimeConnection({
        runtime: { bootstrap: () => ({ kind: "bad" }) },
      }),
    /Invalid Runtime connection/u,
  );
  assert.throws(
    () =>
      readWorkbenchDesktopRuntimeConnection({
        runtime: {
          bootstrap: () => {
            throw new Error("denied");
          },
        },
      }),
    /denied/u,
  );
  assert.throws(
    () =>
      readWorkbenchDesktopRuntimeConnection({
        runtime: {
          bootstrap: () => connectionWithExtraPortKey,
          extra: true,
        },
      }),
    /Invalid desktop Runtime bootstrap port/u,
  );
});

const connectionWithExtraPortKey = defineRuntimeConnection({
  kind: "same-origin",
  protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
  httpOrigin: "http://127.0.0.1:43201",
});
