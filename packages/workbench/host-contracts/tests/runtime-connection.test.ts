import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  RuntimeWebSocketAuthenticationErrorCode,
  createRuntimeWebSocketAuthenticatedFrame,
  createRuntimeWebSocketAuthenticationErrorFrame,
  RuntimeWebSocketCloseCode,
  createRuntimeWebSocketAuthenticateFrame,
  defineRuntimeConnection,
  isRuntimeProtocolVersionCompatible,
  parseRuntimeConnection,
  parseRuntimeWebSocketAuthenticationFrame,
  parseRuntimeWebSocketAuthenticateFrame,
  parseRuntimeWebSocketAuthenticatedFrame,
  parseRuntimeWebSocketAuthenticationErrorFrame,
} from "../src/runtime-connection";

test("defines immutable, JSON-safe same-origin and desktop Runtime connections", () => {
  const sameOrigin = defineRuntimeConnection({
    kind: "same-origin",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "https://workbench.example.test",
  });
  const desktop = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "http://127.0.0.1:43127",
    instanceId: "runtime-1",
    accessToken: "desktop-token",
  });

  assert.equal(Object.isFrozen(sameOrigin), true);
  assert.equal(Object.isFrozen(desktop), true);
  assert.deepEqual(JSON.parse(JSON.stringify(desktop)), desktop);
  assert.equal(desktop.kind, "desktop-sidecar");
});

test("parses only complete, current-version Runtime connection descriptors", () => {
  assert.equal(
    parseRuntimeConnection({
      kind: "same-origin",
      protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION + 1,
      httpOrigin: "https://workbench.example.test",
    }),
    undefined,
  );
  assert.equal(
    parseRuntimeConnection({
      kind: "desktop-sidecar",
      protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
      httpOrigin: "http://127.0.0.1:43127",
      instanceId: "runtime-1",
      accessToken: "desktop-token",
      accidental: true,
    }),
    undefined,
  );
  assert.throws(
    () => defineRuntimeConnection({ kind: "desktop-sidecar", accessToken: "desktop-token" }),
    /Invalid Runtime connection descriptor/,
  );
});

test("uses strict versioned WebSocket authentication frames without credentials in acknowledgements", () => {
  const connection = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "http://127.0.0.1:43127",
    instanceId: "runtime-1",
    accessToken: "desktop-token",
  });
  assert.equal(connection.kind, "desktop-sidecar");
  const authenticate = createRuntimeWebSocketAuthenticateFrame(connection);

  assert.equal(Object.isFrozen(authenticate), true);
  assert.deepEqual(parseRuntimeWebSocketAuthenticateFrame(authenticate), authenticate);
  assert.deepEqual(parseRuntimeWebSocketAuthenticationFrame(authenticate), authenticate);
  const authenticated = createRuntimeWebSocketAuthenticatedFrame("runtime-1");
  assert.equal(Object.isFrozen(authenticated), true);
  assert.deepEqual(parseRuntimeWebSocketAuthenticatedFrame(authenticated), authenticated);
  const error = createRuntimeWebSocketAuthenticationErrorFrame(
    RuntimeWebSocketAuthenticationErrorCode.protocolVersionMismatch,
  );
  assert.equal(Object.isFrozen(error), true);
  assert.deepEqual(parseRuntimeWebSocketAuthenticationErrorFrame(error), error);
  assert.ok(error);
  assert.equal("accessToken" in error, false);
  assert.equal(error.message.includes(connection.accessToken), false);
  assert.equal(isRuntimeProtocolVersionCompatible(RUNTIME_CONNECTION_PROTOCOL_VERSION), true);
  assert.equal(isRuntimeProtocolVersionCompatible(RUNTIME_CONNECTION_PROTOCOL_VERSION + 1), false);
});

test("keeps stable application WebSocket close codes and rejects malformed frames", () => {
  assert.equal(RuntimeWebSocketCloseCode.invalidAuthenticationFrame, 4400);
  assert.equal(RuntimeWebSocketCloseCode.authenticationFailed, 4401);
  assert.equal(RuntimeWebSocketCloseCode.authenticationTimeout, 4408);
  assert.equal(RuntimeWebSocketCloseCode.protocolVersionMismatch, 4409);
  assert.equal(
    parseRuntimeWebSocketAuthenticateFrame({
      type: "authenticate",
      protocolVersion: 0,
      instanceId: "runtime-1",
      accessToken: "desktop-token",
    }),
    undefined,
  );
  assert.equal(
    parseRuntimeWebSocketAuthenticatedFrame({
      type: "authenticated",
      protocolVersion: 1,
      instanceId: "runtime-1",
      accessToken: "must-not-be-present",
    }),
    undefined,
  );
});
