import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  generateDirectHpkeKeyPair,
  openDirectPairingEnvelope,
  sealDirectRemoteEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import { parseDirectPairingClaimV1 } from "@workbench/remote-control-contracts/codecs";
import type {
  DirectPairingPayloadV1,
  DirectSealedEnvelopeV1,
} from "@workbench/remote-control-contracts/protocol";

import {
  createMobileDirectPairingController,
  type MobileDirectPairingSession,
} from "../src/features/direct-pairing.ts";

const cryptoValue = webcrypto as unknown as Crypto;

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

async function fixture({ failProfile = false, failFirstEndpoint = false } = {}) {
  const desktop = await generateDirectHpkeKeyPair();
  const payload: DirectPairingPayloadV1 = {
    type: "workbench.remote.direct-pairing",
    version: 1,
    pairingId: "pairing-1",
    pairingSecret: "S".repeat(43),
    manualCode: "ABC23456",
    machineId: "machine-1",
    machineDisplayName: "Studio",
    desktopEncryptionKeyId: "desktop-key-1",
    desktopEncryptionPublicKey: encode(desktop.publicKey),
    desktopEncryptionKeyFingerprint: `sha256:${"a".repeat(43)}`,
    endpoints: [
      { kind: "local-network", host: "192.168.1.20", port: 8787 },
      { kind: "tailscale", host: "100.100.10.20", port: 8787 },
    ],
    protocolRange: { min: 1, max: 1 },
    expiresAt: "2026-09-13T12:02:00.000Z",
  };
  let claimEnvelope: DirectSealedEnvelopeV1 | undefined;
  const closed: string[] = [];
  const savedKeys: object[] = [];
  const cleared: string[] = [];
  const profiles: object[] = [];
  const connectedEndpoints: string[] = [];
  let connectedEndpoint = payload.endpoints[0]!;
  const session: MobileDirectPairingSession = {
    hello: async () => ({
      type: "direct.pairing.hello",
      version: 1,
      pairingId: payload.pairingId,
      machineId: payload.machineId,
      machineDisplayName: payload.machineDisplayName,
      endpoint: connectedEndpoint,
      desktopEncryptionKeyId: payload.desktopEncryptionKeyId,
      desktopEncryptionPublicKey: payload.desktopEncryptionPublicKey,
      desktopEncryptionKeyFingerprint: payload.desktopEncryptionKeyFingerprint,
      protocolRange: payload.protocolRange,
      expiresAt: payload.expiresAt,
    }),
    sendClaim: async (envelope) => void (claimEnvelope = envelope),
    receiveResult: async () => {
      assert.ok(claimEnvelope);
      const plaintext = await openDirectPairingEnvelope({
        envelope: claimEnvelope,
        expectedMachineId: payload.machineId,
        expectedDeviceId: claimEnvelope.deviceId,
        expectedDirection: "mobile-to-desktop",
        now: new Date("2026-09-13T12:00:01.000Z"),
        resolveRecipientPrivateKey: (keyId) =>
          keyId === payload.desktopEncryptionKeyId ? desktop.privateKey : undefined,
      });
      const claim = parseDirectPairingClaimV1(JSON.parse(new TextDecoder().decode(plaintext)));
      assert.ok(claim);
      return sealDirectRemoteEnvelope({
        plaintext: new TextEncoder().encode(
          JSON.stringify({
            type: "direct.pairing.result",
            pairingId: payload.pairingId,
            state: "confirmed",
            deviceId: claim.deviceId,
            authorizationRevision: "revision-1",
            scope: [
              "sessions.read",
              "sessions.create",
              "sessions.send",
              "sessions.stop",
              "sessions.organize",
              "interactions.respond",
            ],
            desktopIdentity: {
              machineId: payload.machineId,
              machineDisplayName: payload.machineDisplayName,
              desktopEncryptionKeyId: payload.desktopEncryptionKeyId,
              desktopEncryptionPublicKey: payload.desktopEncryptionPublicKey,
              desktopEncryptionKeyFingerprint: payload.desktopEncryptionKeyFingerprint,
            },
            approvedEndpoints: payload.endpoints,
          }),
        ),
        header: {
          protocolVersion: 1,
          envelopeId: "pairing-result-1",
          machineId: payload.machineId,
          deviceId: claim.deviceId,
          direction: "desktop-to-mobile",
          contentType: "pairing",
          createdAt: "2026-09-13T12:00:01.000Z",
          expiresAt: "2026-09-13T12:00:31.000Z",
        },
        recipient: {
          keyId: claim.mobileEncryptionKeyId,
          publicKey: Buffer.from(claim.mobileEncryptionPublicKey, "base64url"),
        },
        senderPrivateKey: desktop.privateKey,
      });
    },
    close: (reason) => void closed.push(reason),
  };
  const controller = createMobileDirectPairingController({
    transport: {
      connect: async (endpoint) => {
        connectedEndpoint = endpoint;
        connectedEndpoints.push(`${endpoint.kind}:${endpoint.host}:${endpoint.port}`);
        if (failFirstEndpoint && endpoint.kind === "local-network") {
          throw new Error("network_error");
        }
        return session;
      },
    },
    secureStore: {
      saveMachineKeys: async (_machineId, keys) => void savedKeys.push(keys),
      clearMachine: async (machineId) => void cleared.push(machineId),
    },
    profileStore: {
      save: async (profile) => {
        if (failProfile) throw new Error("profile_write_failed");
        profiles.push(profile);
      },
    },
    readCrypto: () => cryptoValue,
    now: () => new Date("2026-09-13T12:00:00.000Z"),
  });
  return {
    controller,
    payload,
    claimEnvelope: () => claimEnvelope,
    savedKeys,
    cleared,
    profiles,
    closed,
    connectedEndpoints,
  };
}

test("pairs from an account-free QR through an encrypted claim and atomic profile commit", async () => {
  const value = await fixture();
  const pending = await value.controller.beginQr({
    rawCode: JSON.stringify(value.payload),
    displayName: "My phone",
    platform: "android",
  });
  assert.match(pending.safetyCode, /^\d{3} \d{3}$/u);
  assert.equal(value.savedKeys.length, 0);
  const profile = await pending.complete();
  assert.equal(profile.machineId, value.payload.machineId);
  assert.equal("accountId" in profile, false);
  assert.equal("relayOrigin" in profile, false);
  assert.equal(value.savedKeys.length, 1);
  assert.equal(value.profiles.length, 1);
  assert.equal(value.closed.at(-1), "pairing_complete");
});

test("supports manual host, port, and one-time code with the same safety flow", async () => {
  const value = await fixture();
  const pending = await value.controller.beginManual({
    host: "192.168.1.20",
    port: 8787,
    manualCode: value.payload.manualCode,
    displayName: "My phone",
    platform: "ios",
  });
  assert.match(pending.safetyCode, /^\d{3} \d{3}$/u);
  await pending.complete();
  assert.equal(value.profiles.length, 1);
});

test("falls back from an unreachable LAN address to the invitation's Tailscale address", async () => {
  const value = await fixture({ failFirstEndpoint: true });
  const pending = await value.controller.beginQr({
    rawCode: JSON.stringify(value.payload),
    displayName: "My phone",
    platform: "ios",
  });
  assert.deepEqual(value.connectedEndpoints, [
    "local-network:192.168.1.20:8787",
    "tailscale:100.100.10.20:8787",
  ]);
  await pending.complete();
});

test("clears private keys when the SQLite profile commit fails and supports cancellation", async () => {
  const value = await fixture({ failProfile: true });
  const pending = await value.controller.beginQr({
    rawCode: JSON.stringify(value.payload),
    displayName: "My phone",
    platform: "android",
  });
  await assert.rejects(pending.complete(), /profile_write_failed/u);
  assert.deepEqual(value.cleared, [value.payload.machineId]);

  const second = await fixture();
  const cancellable = await second.controller.beginQr({
    rawCode: JSON.stringify(second.payload),
    displayName: "My phone",
    platform: "android",
  });
  cancellable.cancel();
  assert.equal(second.closed.at(-1), "pairing_cancelled");
});

test("rejects public manual endpoints and a substituted desktop identity", async () => {
  const value = await fixture();
  await assert.rejects(
    value.controller.beginManual({
      host: "8.8.8.8",
      port: 8787,
      manualCode: value.payload.manualCode,
      displayName: "My phone",
      platform: "ios",
    }),
    /endpoint_not_allowed/u,
  );
  const replaced = {
    ...value.payload,
    desktopEncryptionKeyFingerprint: `sha256:${"b".repeat(43)}`,
  };
  await assert.rejects(
    value.controller.beginQr({
      rawCode: JSON.stringify(replaced),
      displayName: "My phone",
      platform: "ios",
    }),
    /identity_mismatch/u,
  );
});
