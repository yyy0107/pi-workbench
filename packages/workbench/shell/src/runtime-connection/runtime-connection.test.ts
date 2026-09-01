import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  type RuntimeConnection,
} from "@workbench/host-contracts";

import { createSameOriginRuntimeConnection, snapshotRuntimeConnection } from "./runtime-connection";

test("creates an immutable same-origin descriptor from the renderer origin", () => {
  const connection = createSameOriginRuntimeConnection("https://workbench.example:8443");

  assert.deepEqual(connection, {
    kind: "same-origin",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "https://workbench.example:8443",
  });
  assert.equal(Object.isFrozen(connection), true);
});

test("snapshots an assembly descriptor instead of retaining caller-owned mutable state", () => {
  const input = {
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "http://127.0.0.1:43123",
    instanceId: "runtime-a",
    accessToken: "runtime-a-token",
  } as RuntimeConnection;
  const snapshot = snapshotRuntimeConnection(input);

  assert.notEqual(snapshot, input);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(snapshot, input);
});
