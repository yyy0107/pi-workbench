import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  generateDirectHpkeKeyPair,
  sealDirectRemoteEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import { canonicalDirectSocketAuthenticationTranscript } from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectSocketAuthenticateV1,
  DirectSocketChallengeV1,
} from "@workbench/remote-control-contracts/protocol";

import { createDirectRemoteGateway } from "../src/gateway.ts";
import type { DirectSocketPort, PairedPhoneAuthorization } from "../src/ports.ts";

function memorySocket(remoteAddress = "192.168.1.44") {
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const messages = new Set<(frame: string) => void>();
  const closeListeners = new Set<() => void>();
  const socket: DirectSocketPort = {
    remoteAddress,
    send: async (frame) => void sent.push(frame),
    close: (code, reason) => void closes.push({ code, reason }),
    onMessage(listener) {
      messages.add(listener);
      return { dispose: () => void messages.delete(listener) };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return { dispose: () => void closeListeners.delete(listener) };
    },
  };
  return {
    socket,
    sent,
    closes,
    receive: (value: unknown) => {
      for (const listener of messages) listener(JSON.stringify(value));
    },
  };
}

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition_not_reached");
};

async function fixture() {
  const desktopKeys = await generateDirectHpkeKeyPair();
  const mobileKeys = await generateDirectHpkeKeyPair();
  const signing = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = signing.publicKey.export({ format: "jwk" });
  const installation = {
    machineId: "machine-1",
    displayName: "Studio",
    encryptionKeyId: "desktop-key-1",
    encryptionPublicKey: Buffer.from(desktopKeys.publicKey).toString("base64url"),
    encryptionPrivateKey: Buffer.from(desktopKeys.privateKey).toString("base64url"),
    fingerprint: `sha256:${"a".repeat(43)}`,
    createdAt: "2026-09-13T12:00:00.000Z",
  };
  const authorization: PairedPhoneAuthorization = {
    deviceId: "phone-1",
    displayName: "My phone",
    platform: "ios",
    signingPublicKey: {
      kty: "EC",
      crv: "P-256",
      x: jwk.x!,
      y: jwk.y!,
      key_ops: ["verify"],
      ext: true,
    },
    signingKeyFingerprint: `sha256:${"b".repeat(43)}`,
    encryptionKeyId: "mobile-key-1",
    encryptionPublicKey: Buffer.from(mobileKeys.publicKey).toString("base64url"),
    encryptionKeyFingerprint: `sha256:${"c".repeat(43)}`,
    scope: [
      "sessions.read",
      "sessions.create",
      "sessions.send",
      "sessions.stop",
      "sessions.organize",
      "interactions.respond",
    ],
    revision: "authorization-1",
    createdAt: "2026-09-13T12:00:00.000Z",
  };
  const endpoint = { kind: "local-network", host: "192.168.1.20", port: 8787 } as const;
  let authorizations: readonly PairedPhoneAuthorization[] = [authorization];
  let byte = 1;
  const processed: string[] = [];
  const subscriptions: string[] = [];
  const gateway = createDirectRemoteGateway({
    installation,
    endpoints: () => [endpoint],
    clock: { now: () => new Date("2026-09-13T12:00:00.000Z") },
    randomBytes: (size) => new Uint8Array(size).fill(byte++),
    authorizationStore: {
      list: async () => authorizations,
      replace: async (value) => void (authorizations = value),
    },
    approval: { publishClaim() {} },
    epoch: "epoch-1",
    business: {
      async process({ envelope }) {
        processed.push(envelope.envelopeId);
        return [];
      },
      subscribe(value) {
        subscriptions.push(value.deviceId);
        return { dispose: () => void subscriptions.push(`closed:${value.deviceId}`) };
      },
    },
  });
  return {
    authorization,
    desktopKeys,
    endpoint,
    gateway,
    installation,
    mobileKeys,
    processed,
    signing,
    subscriptions,
    setAuthorizations: (value: readonly PairedPhoneAuthorization[]) =>
      void (authorizations = value),
  };
}

async function authenticate(
  value: Awaited<ReturnType<typeof fixture>>,
  wire: ReturnType<typeof memorySocket>,
) {
  value.gateway.accept(wire.socket, value.endpoint, "authenticated");
  await waitFor(() => wire.sent.length === 1);
  const challenge = JSON.parse(wire.sent[0]!) as DirectSocketChallengeV1;
  const resume = { unresolvedOperationIds: [] };
  const transcript = canonicalDirectSocketAuthenticationTranscript({
    connectionId: challenge.connectionId,
    nonce: challenge.nonce,
    machineId: challenge.machineId,
    deviceId: value.authorization.deviceId,
    authorizationRevision: value.authorization.revision,
    endpoint: challenge.endpoint,
    protocolVersion: 1,
    resume,
    expiresAt: challenge.expiresAt,
  });
  const authentication: DirectSocketAuthenticateV1 = {
    type: "direct.socket.authenticate",
    version: 1,
    connectionId: challenge.connectionId,
    deviceId: value.authorization.deviceId,
    authorizationRevision: value.authorization.revision,
    protocolRange: { min: 1, max: 1 },
    resume,
    challengeProof: sign("sha256", Buffer.from(transcript), value.signing.privateKey).toString(
      "base64url",
    ),
  };
  wire.receive(authentication);
  await waitFor(() => wire.sent.length === 2 || wire.closes.length > 0);
  return challenge;
}

test("authenticates only a fresh signed device challenge before dispatching sealed frames", async () => {
  const value = await fixture();
  const wire = memorySocket();
  await authenticate(value, wire);
  assert.equal(wire.closes.length, 0);
  assert.equal(JSON.parse(wire.sent[1]!).type, "direct.socket.authenticated");
  assert.deepEqual(value.subscriptions, ["phone-1"]);

  const envelope = await sealDirectRemoteEnvelope({
    plaintext: new TextEncoder().encode(JSON.stringify({ type: "control.request" })),
    header: {
      protocolVersion: 1,
      envelopeId: "envelope-1",
      machineId: value.installation.machineId,
      deviceId: value.authorization.deviceId,
      direction: "mobile-to-desktop",
      contentType: "command",
      createdAt: "2026-09-13T12:00:00.000Z",
      expiresAt: "2026-09-13T12:01:00.000Z",
    },
    recipient: {
      keyId: value.installation.encryptionKeyId,
      publicKey: value.desktopKeys.publicKey,
    },
    senderPrivateKey: value.mobileKeys.privateKey,
  });
  wire.receive(envelope);
  await waitFor(() => value.processed.length === 1);
  assert.deepEqual(value.processed, ["envelope-1"]);
  wire.receive(envelope);
  await waitFor(() => wire.closes.length === 1);
  assert.equal(wire.closes[0]?.reason, "invalid_frame");
});

test("rejects business frames before authentication and stale authorization revisions", async () => {
  const value = await fixture();
  const unauthenticated = memorySocket();
  value.gateway.accept(unauthenticated.socket, value.endpoint, "authenticated");
  await waitFor(() => unauthenticated.sent.length === 1);
  unauthenticated.receive({ protocolVersion: 1 });
  await waitFor(() => unauthenticated.closes.length === 1);
  assert.equal(value.processed.length, 0);

  const stale = memorySocket("192.168.1.45");
  value.gateway.accept(stale.socket, value.endpoint, "authenticated");
  await waitFor(() => stale.sent.length === 1);
  const challenge = JSON.parse(stale.sent[0]!) as DirectSocketChallengeV1;
  stale.receive({
    type: "direct.socket.authenticate",
    version: 1,
    connectionId: challenge.connectionId,
    deviceId: "phone-1",
    authorizationRevision: "stale-revision",
    protocolRange: { min: 1, max: 1 },
    resume: { unresolvedOperationIds: [] },
    challengeProof: "AAAA",
  });
  await waitFor(() => stale.sent.length === 2 && stale.closes.length === 1);
  assert.equal(JSON.parse(stale.sent[1]!).code, "authorization_revision_changed");
});

test("rechecks revocation and closes every active socket for the revoked phone", async () => {
  const value = await fixture();
  const first = memorySocket();
  const second = memorySocket("192.168.1.45");
  await authenticate(value, first);
  await authenticate(value, second);
  value.gateway.revokeDevice("phone-1");
  assert.equal(first.closes.at(-1)?.reason, "device_revoked");
  assert.equal(second.closes.at(-1)?.reason, "device_revoked");
  assert.equal(value.subscriptions.filter((item) => item === "closed:phone-1").length, 2);
});

test("rejects unknown, revoked, incompatible, replayed, and unselected endpoint authentication", async () => {
  const value = await fixture();

  const unknown = memorySocket();
  value.gateway.accept(unknown.socket, value.endpoint, "authenticated");
  await waitFor(() => unknown.sent.length === 1);
  const unknownChallenge = JSON.parse(unknown.sent[0]!) as DirectSocketChallengeV1;
  value.setAuthorizations([]);
  unknown.receive({
    type: "direct.socket.authenticate",
    version: 1,
    connectionId: unknownChallenge.connectionId,
    deviceId: "phone-unknown",
    authorizationRevision: "authorization-1",
    protocolRange: { min: 1, max: 1 },
    resume: { unresolvedOperationIds: [] },
    challengeProof: "AAAA",
  });
  await waitFor(() => unknown.closes.length === 1);
  assert.equal(JSON.parse(unknown.sent[1]!).code, "authentication_failed");

  const revoked = memorySocket("192.168.1.45");
  value.setAuthorizations([{ ...value.authorization, revokedAt: "2026-09-13T11:59:00.000Z" }]);
  value.gateway.accept(revoked.socket, value.endpoint, "authenticated");
  await waitFor(() => revoked.sent.length === 1);
  const revokedChallenge = JSON.parse(revoked.sent[0]!) as DirectSocketChallengeV1;
  revoked.receive({
    type: "direct.socket.authenticate",
    version: 1,
    connectionId: revokedChallenge.connectionId,
    deviceId: value.authorization.deviceId,
    authorizationRevision: value.authorization.revision,
    protocolRange: { min: 1, max: 1 },
    resume: { unresolvedOperationIds: [] },
    challengeProof: "AAAA",
  });
  await waitFor(() => revoked.closes.length === 1);
  assert.equal(JSON.parse(revoked.sent[1]!).code, "device_revoked");

  const incompatible = memorySocket("192.168.1.46");
  value.setAuthorizations([value.authorization]);
  value.gateway.accept(incompatible.socket, value.endpoint, "authenticated");
  await waitFor(() => incompatible.sent.length === 1);
  const incompatibleChallenge = JSON.parse(incompatible.sent[0]!) as DirectSocketChallengeV1;
  incompatible.receive({
    type: "direct.socket.authenticate",
    version: 1,
    connectionId: incompatibleChallenge.connectionId,
    deviceId: value.authorization.deviceId,
    authorizationRevision: value.authorization.revision,
    protocolRange: { min: 2, max: 2 },
    resume: { unresolvedOperationIds: [] },
    challengeProof: "AAAA",
  });
  await waitFor(() => incompatible.closes.length === 1);
  assert.equal(JSON.parse(incompatible.sent[1]!).code, "protocol_version_mismatch");

  const replayed = memorySocket("192.168.1.47");
  value.gateway.accept(replayed.socket, value.endpoint, "authenticated");
  await waitFor(() => replayed.sent.length === 1);
  replayed.receive({
    type: "direct.socket.authenticate",
    version: 1,
    connectionId: unknownChallenge.connectionId,
    deviceId: value.authorization.deviceId,
    authorizationRevision: value.authorization.revision,
    protocolRange: { min: 1, max: 1 },
    resume: { unresolvedOperationIds: [] },
    challengeProof: "AAAA",
  });
  await waitFor(() => replayed.closes.length === 1);
  assert.equal(replayed.sent.length, 1);

  const wrongEndpoint = memorySocket("192.168.1.48");
  value.gateway.accept(
    wrongEndpoint.socket,
    { kind: "tailscale", host: "100.64.0.9", port: 8787 },
    "authenticated",
  );
  assert.equal(wrongEndpoint.closes.at(-1)?.reason, "listener_disabled");
  assert.equal(wrongEndpoint.sent.length, 0);
});

test("expires an unanswered fresh authentication challenge", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const value = await fixture();
  const wire = memorySocket();
  value.gateway.accept(wire.socket, value.endpoint, "authenticated");
  await Promise.resolve();
  assert.equal(wire.sent.length, 1);
  t.mock.timers.tick(5_000);
  assert.equal(wire.closes.at(-1)?.reason, "authentication_failed");
});
