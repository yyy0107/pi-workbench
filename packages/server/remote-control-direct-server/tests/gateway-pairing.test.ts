import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  generateDirectHpkeKeyPair,
  openDirectRemoteEnvelope,
  sealDirectPairingEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import { canonicalDirectPairingTranscript } from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectPairingClaimV1,
  DirectPairingHelloV1,
} from "@workbench/remote-control-contracts/protocol";

import { createDirectRemoteGateway } from "../src/gateway.ts";
import { createDirectSecretProof } from "../src/pairing-service.ts";
import type { DirectSocketPort, PairedPhoneAuthorization } from "../src/ports.ts";

function memorySocket() {
  const sent: string[] = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const messages = new Set<(frame: string) => void>();
  const closeListeners = new Set<() => void>();
  const socket: DirectSocketPort = {
    remoteAddress: "192.168.1.44",
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

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error("condition_not_reached");
}

test("keeps business data closed until an encrypted claim is locally confirmed", async () => {
  const desktopKeys = await generateDirectHpkeKeyPair();
  const mobileKeys = await generateDirectHpkeKeyPair();
  const installation = {
    machineId: "machine-1",
    displayName: "Studio",
    encryptionKeyId: "desktop-key-1",
    encryptionPublicKey: Buffer.from(desktopKeys.publicKey).toString("base64url"),
    encryptionPrivateKey: Buffer.from(desktopKeys.privateKey).toString("base64url"),
    fingerprint: `sha256:${"a".repeat(43)}`,
    createdAt: "2026-09-13T12:00:00.000Z",
  };
  const endpoint = { kind: "local-network", host: "192.168.1.20", port: 8787 } as const;
  let byte = 1;
  let authorizations: readonly PairedPhoneAuthorization[] = [];
  const claims: unknown[] = [];
  const gateway = createDirectRemoteGateway({
    installation,
    endpoints: () => [endpoint],
    clock: { now: () => new Date("2026-09-13T12:00:00.000Z") },
    randomBytes: (size) => new Uint8Array(size).fill(byte++),
    authorizationStore: {
      list: async () => authorizations,
      replace: async (value) => void (authorizations = value),
    },
    approval: { publishClaim: (value) => claims.push(value) },
  });
  const payload = gateway.createPairing();
  const wire = memorySocket();
  gateway.accept(wire.socket, endpoint, "pairing");
  const hello = JSON.parse(wire.sent[0]!) as DirectPairingHelloV1;
  assert.equal(hello.type, "direct.pairing.hello");
  assert.equal(JSON.stringify(hello).includes("pairingSecret"), false);

  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const secretProof = createDirectSecretProof(payload.pairingSecret);
  const claimBase = {
    type: "direct.pairing.claim",
    pairingId: payload.pairingId,
    secretProof,
    deviceId: "phone-1",
    deviceDisplayName: "My phone",
    platform: "android",
    mobileSigningPublicJwk: {
      kty: "EC",
      crv: "P-256",
      x: jwk.x!,
      y: jwk.y!,
      key_ops: ["verify"],
      ext: true,
    },
    mobileSigningKeyFingerprint: `sha256:${"b".repeat(43)}`,
    mobileEncryptionKeyId: "mobile-key-1",
    mobileEncryptionPublicKey: Buffer.from(mobileKeys.publicKey).toString("base64url"),
    mobileEncryptionKeyFingerprint: `sha256:${"c".repeat(43)}`,
  } as const;
  const transcript = canonicalDirectPairingTranscript({
    pairingId: payload.pairingId,
    secretProof,
    endpoint,
    machineId: payload.machineId,
    machineDisplayName: payload.machineDisplayName,
    desktopEncryptionKeyId: payload.desktopEncryptionKeyId,
    desktopEncryptionPublicKey: payload.desktopEncryptionPublicKey,
    desktopEncryptionKeyFingerprint: payload.desktopEncryptionKeyFingerprint,
    phoneDeviceId: claimBase.deviceId,
    mobileEncryptionKeyId: claimBase.mobileEncryptionKeyId,
    mobileEncryptionKeyFingerprint: claimBase.mobileEncryptionKeyFingerprint,
    mobileSigningKeyFingerprint: claimBase.mobileSigningKeyFingerprint,
    protocolVersion: 1,
    expiresAt: payload.expiresAt,
  });
  const claim: DirectPairingClaimV1 = {
    ...claimBase,
    transcriptProof: sign("sha256", Buffer.from(transcript), privateKey).toString("base64url"),
  };
  const claimEnvelope = await sealDirectPairingEnvelope({
    plaintext: new TextEncoder().encode(JSON.stringify(claim)),
    header: {
      protocolVersion: 1,
      envelopeId: "pairing-envelope-1",
      machineId: installation.machineId,
      deviceId: claim.deviceId,
      direction: "mobile-to-desktop",
      contentType: "pairing",
      createdAt: "2026-09-13T12:00:00.000Z",
      expiresAt: payload.expiresAt,
    },
    recipient: { keyId: installation.encryptionKeyId, publicKey: desktopKeys.publicKey },
  });
  wire.receive(claimEnvelope);
  await waitFor(() => claims.length === 1 || wire.closes.length > 0);
  assert.equal(claims.length, 1);
  assert.equal(authorizations.length, 0);
  assert.equal(wire.sent.length, 1);

  const safetyCode = (claims[0] as { safetyCode: string }).safetyCode;
  await gateway.confirmPairing(payload.pairingId, safetyCode);
  assert.equal(authorizations.length, 1);
  assert.equal(wire.sent.length, 2);
  const resultEnvelope = JSON.parse(wire.sent[1]!);
  const result = JSON.parse(
    new TextDecoder().decode(
      await openDirectRemoteEnvelope({
        envelope: resultEnvelope,
        expectedMachineId: installation.machineId,
        expectedDeviceId: claim.deviceId,
        expectedDirection: "desktop-to-mobile",
        senderPublicKey: desktopKeys.publicKey,
        now: new Date("2026-09-13T12:00:01.000Z"),
        resolveRecipientPrivateKey: () => mobileKeys.privateKey,
      }),
    ),
  );
  assert.equal(result.state, "confirmed");
  assert.deepEqual(wire.closes.at(-1), { code: 1000, reason: "pairing_complete" });
});

test("authenticated mode emits only a fresh public challenge before device proof", async () => {
  const wire = memorySocket();
  const gateway = createDirectRemoteGateway({
    installation: {
      machineId: "machine-1",
      displayName: "Studio",
      encryptionKeyId: "desktop-key-1",
      encryptionPublicKey: "A".repeat(87),
      encryptionPrivateKey: "A".repeat(43),
      fingerprint: `sha256:${"a".repeat(43)}`,
      createdAt: "2026-09-13T12:00:00.000Z",
    },
    endpoints: () => [{ kind: "local-network", host: "192.168.1.20", port: 8787 }],
    clock: { now: () => new Date("2026-09-13T12:00:00.000Z") },
    randomBytes: (size) => new Uint8Array(size),
    authorizationStore: { list: async () => [], replace: async () => {} },
    approval: { publishClaim: () => {} },
  });
  gateway.accept(
    wire.socket,
    { kind: "local-network", host: "192.168.1.20", port: 8787 },
    "authenticated",
  );
  await waitFor(() => wire.sent.length === 1);
  const challenge = JSON.parse(wire.sent[0]!);
  assert.equal(challenge.type, "direct.socket.challenge");
  assert.equal(challenge.machineId, "machine-1");
  assert.equal(JSON.stringify(challenge).includes("encryptionPrivateKey"), false);
  assert.deepEqual(wire.closes, []);
  gateway.dispose();
});
