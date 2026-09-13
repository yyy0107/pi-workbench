import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimeConnectedWebMode,
  createRuntimeConnectedWebStartMessage,
  parseCanonicalLoopbackHttpOrigin,
  parseRuntimeConnectedWebStartMessage,
} from "@workbench/host-contracts/runtime-connected-web-control";
import { RUNTIME_CONNECTION_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-connection";

const runtimeConnection = Object.freeze({
  kind: "desktop-sidecar" as const,
  protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
  httpOrigin: "http://127.0.0.1:43128",
  instanceId: "runtime-one",
  accessToken: "root-only-secret",
});

test("creates an exact immutable development or production Web start message", () => {
  for (const mode of Object.values(RuntimeConnectedWebMode)) {
    const message = createRuntimeConnectedWebStartMessage({
      mode,
      publicOrigin: "http://127.0.0.1:43127",
      runtimeConnection,
    });
    assert.deepEqual(parseRuntimeConnectedWebStartMessage(message), message);
    assert.equal(Object.isFrozen(message), true);
    assert.equal(Object.isFrozen(message.runtimeConnection), true);
  }
});

test("accepts only canonical nonzero IPv4 loopback origins", () => {
  assert.equal(
    parseCanonicalLoopbackHttpOrigin("http://127.0.0.1:43127"),
    "http://127.0.0.1:43127",
  );
  for (const value of [
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://localhost:43127",
    "http://[::1]:43127",
    "https://127.0.0.1:43127",
    "http://127.0.0.1:43127/path",
    "http://user@127.0.0.1:43127",
    " http://127.0.0.1:43127",
  ]) {
    assert.equal(parseCanonicalLoopbackHttpOrigin(value), undefined);
  }
});

test("fails closed on extra keys, reflected origins, mode drift, and unsafe credentials", () => {
  const valid = createRuntimeConnectedWebStartMessage({
    mode: RuntimeConnectedWebMode.production,
    publicOrigin: "http://127.0.0.1:43127",
    runtimeConnection,
  });
  assert.equal(parseRuntimeConnectedWebStartMessage({ ...valid, extra: true }), undefined);
  assert.equal(parseRuntimeConnectedWebStartMessage({ ...valid, mode: "preview" }), undefined);
  assert.equal(
    parseRuntimeConnectedWebStartMessage({
      ...valid,
      runtimeConnection: { ...runtimeConnection, httpOrigin: valid.publicOrigin },
    }),
    undefined,
  );
  assert.equal(
    parseRuntimeConnectedWebStartMessage({
      ...valid,
      runtimeConnection: { ...runtimeConnection, accessToken: "leaked\nsecret" },
    }),
    undefined,
  );
});
