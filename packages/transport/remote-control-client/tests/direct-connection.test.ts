import assert from "node:assert/strict";
import test from "node:test";

import { createDirectRemoteControlConnection } from "../src/connection.ts";
import type { RemoteControlClientSocket } from "../src/ports.ts";

function fixture() {
  let now = Date.parse("2026-09-13T12:00:00.000Z");
  const sent: string[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const states: string[] = [];
  const socket: RemoteControlClientSocket = {
    bufferedAmount: 0,
    send: (frame) => sent.push(frame),
    close: (code, reason) => closes.push({ code, reason }),
  };
  const connection = createDirectRemoteControlConnection({
    clock: { now: () => new Date(now) },
    random: { nextUnit: () => 0.5 },
    socketPort: {
      connect: (request) => {
        assert.equal(request.url, "ws://192.168.1.20:8787/remote/v1/direct");
        assert.deepEqual(request.protocols, ["workbench.remote.direct.v1"]);
        return socket;
      },
    },
    challengeProof: {
      sign: async (transcript) => {
        assert.match(transcript, /workbench\.remote\.direct-socket-authentication/u);
        assert.doesNotMatch(transcript, /account|relay|ticket/iu);
        return "P".repeat(86);
      },
    },
    onStateChanged: (state) => states.push(state),
  });
  const input = {
    endpoints: [{ kind: "local-network", host: "192.168.1.20", port: 8787 }],
    machineId: "machine-1",
    deviceId: "phone-1",
    authorizationRevision: "revision-1",
    desktopEncryptionKeyId: "desktop-key-1",
    desktopEncryptionKeyFingerprint: `sha256:${"a".repeat(43)}`,
    protocolRange: { min: 1, max: 1 },
    resume: { unresolvedOperationIds: ["operation-1"] },
  } as const;
  const challenge = {
    type: "direct.socket.challenge",
    version: 1,
    connectionId: "connection-1",
    nonce: "N".repeat(43),
    machineId: input.machineId,
    desktopEncryptionKeyId: input.desktopEncryptionKeyId,
    desktopEncryptionKeyFingerprint: input.desktopEncryptionKeyFingerprint,
    endpoint: input.endpoints[0],
    protocolRange: input.protocolRange,
    expiresAt: "2026-09-13T12:00:05.000Z",
  } as const;
  return {
    connection,
    input,
    challenge,
    sent,
    closes,
    states,
    advance: (milliseconds: number) => (now += milliseconds),
  };
}

test("uses a credential-free direct URL and sends signed challenge authentication first", async () => {
  const value = fixture();
  value.connection.start(value.input);
  assert.equal(value.connection.state, "connecting");
  assert.deepEqual(value.sent, []);

  await value.connection.receive(JSON.stringify(value.challenge));
  assert.equal(value.connection.state, "synchronizing");
  assert.equal(value.sent.length, 1);
  assert.deepEqual(JSON.parse(value.sent[0]!), {
    type: "direct.socket.authenticate",
    version: 1,
    connectionId: "connection-1",
    deviceId: "phone-1",
    authorizationRevision: "revision-1",
    protocolRange: { min: 1, max: 1 },
    resume: { unresolvedOperationIds: ["operation-1"] },
    challengeProof: "P".repeat(86),
  });

  await value.connection.receive(
    JSON.stringify({
      type: "direct.socket.authenticated",
      version: 1,
      protocolVersion: 1,
      connectionId: "connection-1",
      machineId: "machine-1",
      machineDisplayName: "Studio Mac",
      deviceId: "phone-1",
      authorizationRevision: "revision-1",
      epoch: "epoch-1",
    }),
  );
  assert.equal(value.connection.state, "ready");
});

test("makes a pinned desktop identity mismatch terminal before sending proof", async () => {
  const value = fixture();
  value.connection.start(value.input);
  await value.connection.receive(
    JSON.stringify({
      ...value.challenge,
      desktopEncryptionKeyFingerprint: `sha256:${"b".repeat(43)}`,
    }),
  );
  assert.equal(value.connection.state, "identity-mismatch");
  assert.deepEqual(value.sent, []);
  assert.deepEqual(value.closes, [{ code: 1008, reason: "identity_mismatch" }]);
});

test("times out an absent first challenge and never reconnects while suspended", () => {
  const value = fixture();
  value.connection.start(value.input);
  value.advance(5_000);
  value.connection.poll();
  assert.equal(value.connection.state, "reconnecting");
  value.connection.suspend();
  assert.equal(value.connection.state, "suspended");
});
