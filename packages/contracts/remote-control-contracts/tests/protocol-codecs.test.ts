import assert from "node:assert/strict";
import test from "node:test";

import {
  REMOTE_CONTROL_PROTOCOL_VERSION,
  negotiateRemoteProtocolVersion,
  parseRemoteCursor,
  parseRemoteErrorV1,
  parseRemoteOperationRequestV1,
} from "../src/codecs";
import {
  parseRemotePushHintV1,
  parseRemoteSealedEnvelopeV1,
  parseSocketAuthenticateV1,
} from "../src/legacy-codecs";
import { canonicalJson, remoteUtf8ByteLength } from "../lib/bounds";

const operation = {
  type: "operation.request",
  operationId: "018f47ca-2a4c-7e00-8000-123456789abc",
  issuedAt: "2026-09-13T20:00:00.000Z",
  expiresAt: "2026-09-13T20:02:00.000Z",
  command: {
    type: "session.send",
    sessionId: "session-1",
    text: "继续检查",
  },
} as const;

test("negotiates only an overlapping positive protocol version", () => {
  assert.equal(REMOTE_CONTROL_PROTOCOL_VERSION, 1);
  assert.equal(negotiateRemoteProtocolVersion({ min: 1, max: 1 }, { min: 1, max: 2 }), 1);
  assert.equal(negotiateRemoteProtocolVersion({ min: 1, max: 1 }, { min: 2, max: 3 }), undefined);
  assert.equal(negotiateRemoteProtocolVersion({ min: 0, max: 1 }, { min: 1, max: 1 }), undefined);
});

test("parses canonical decimal uint64 cursors and rejects unsafe or extra fields", () => {
  assert.deepEqual(parseRemoteCursor({ epoch: "epoch-A", offset: "18446744073709551615" }), {
    epoch: "epoch-A",
    offset: "18446744073709551615",
  });
  for (const value of [
    { epoch: "epoch-A", offset: 1 },
    { epoch: "epoch-A", offset: "01" },
    { epoch: "epoch-A", offset: "18446744073709551616" },
    { epoch: "epoch-A", offset: "1", extra: true },
    { epoch: "époch", offset: "1" },
  ]) {
    assert.equal(parseRemoteCursor(value), undefined);
  }
});

test("strictly parses text-only operations and rejects catch-all or oversized input", () => {
  assert.deepEqual(parseRemoteOperationRequestV1(operation), operation);
  assert.equal(parseRemoteOperationRequestV1({ ...operation, unexpected: true }), undefined);
  assert.equal(
    parseRemoteOperationRequestV1({
      ...operation,
      command: { method: "terminal.exec", payload: { command: "id" } },
    }),
    undefined,
  );
  assert.equal(
    parseRemoteOperationRequestV1({
      ...operation,
      command: { ...operation.command, attachment: { path: "/tmp/secret" } },
    }),
    undefined,
  );
  assert.equal(
    parseRemoteOperationRequestV1({
      ...operation,
      command: { ...operation.command, text: "🙂".repeat(16_385) },
    }),
    undefined,
  );
});

test("enforces authentication, sealed-envelope, and push schemas without credential echoes", () => {
  const authenticate = {
    type: "socket.authenticate",
    version: 1,
    ticket: "ticket-1",
    challengeProof: "proof-1",
    protocolRange: { min: 1, max: 1 },
    resume: {
      cursor: { epoch: "epoch-A", offset: "7" },
      unresolvedOperationIds: ["operation-1"],
    },
  } as const;
  assert.deepEqual(parseSocketAuthenticateV1(authenticate), authenticate);
  assert.equal(parseSocketAuthenticateV1({ ...authenticate, accessToken: "secret" }), undefined);

  const envelope = {
    protocolVersion: 1,
    envelopeId: "envelope-1",
    machineId: "machine-1",
    source: { kind: "mobile", id: "device-1" },
    target: { kind: "desktop", id: "machine-1" },
    contentType: "command",
    keyId: "mobile-key-1",
    createdAt: "2026-09-13T20:00:00.000Z",
    expiresAt: "2026-09-13T20:02:00.000Z",
    hpke: {
      suite: "P256-HKDFSHA256-AES256GCM",
      enc: "AA",
      ciphertext: "BB",
    },
  } as const;
  assert.deepEqual(parseRemoteSealedEnvelopeV1(envelope), envelope);
  assert.equal(parseRemoteSealedEnvelopeV1({ ...envelope, accessToken: "secret" }), undefined);

  const hint = {
    version: 1,
    hintId: "hint-1",
    machineId: "machine-1",
    sessionId: "session-1",
    kind: "attention",
  } as const;
  assert.deepEqual(parseRemotePushHintV1(hint), hint);
  assert.equal(parseRemotePushHintV1({ ...hint, title: "private session" }), undefined);
});

test("bounds JSON depth, UTF-8 bytes, and structured error details", () => {
  assert.equal(remoteUtf8ByteLength("中🙂"), 7);
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');

  let deep: unknown = "leaf";
  for (let index = 0; index < 17; index += 1) deep = { nested: deep };
  assert.equal(
    parseRemoteErrorV1({
      type: "remote.error",
      version: 1,
      code: "invalid_frame",
      details: deep,
    }),
    undefined,
  );
  assert.deepEqual(
    parseRemoteErrorV1({
      type: "remote.error",
      version: 1,
      code: "machine_offline",
      details: { retryable: true },
    }),
    {
      type: "remote.error",
      version: 1,
      code: "machine_offline",
      details: { retryable: true },
    },
  );
  assert.equal(
    parseRemoteErrorV1({
      type: "remote.error",
      version: 1,
      code: "internal",
      details: { stack: "secret" },
    }),
    undefined,
  );
});
