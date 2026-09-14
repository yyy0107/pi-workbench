import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { generateDirectHpkeKeyPair } from "../packages/contracts/remote-control-contracts/src/direct-crypto.ts";
import type { DirectConnectionProfile } from "../packages/transport/remote-control-client/src/profiles.ts";
import { createDirectRemoteGateway } from "../packages/server/remote-control-direct-server/src/gateway.ts";
import type { PairedPhoneAuthorization } from "../packages/server/remote-control-direct-server/src/ports.ts";
import { createMobileDirectPairingController } from "../apps/mobile/src/features/direct-pairing.ts";
import { createMobileDirectPairingWebSocketTransport } from "../apps/mobile/src/state/direct-pairing-transport.ts";
import {
  createInMemoryDirectWebSocket,
  waitForDirectCondition,
} from "./remote-control-direct-integration-harness.ts";

const now = new Date("2030-09-14T20:00:00.000Z");
const endpoint = { kind: "local-network", host: "192.168.1.20", port: 8787 } as const;

test("pairs by QR and manual IP/port/code without an account or central service", async (t) => {
  const desktopKeys = await generateDirectHpkeKeyPair();
  const publicKey = Buffer.from(desktopKeys.publicKey).toString("base64url");
  const installation = {
    machineId: "machine-direct-pairing",
    displayName: "Studio Workbench",
    encryptionKeyId: "desktop-key-direct-pairing",
    encryptionPublicKey: publicKey,
    encryptionPrivateKey: Buffer.from(desktopKeys.privateKey).toString("base64url"),
    fingerprint: `sha256:${createHash("sha256").update(desktopKeys.publicKey).digest("base64url")}`,
    createdAt: now.toISOString(),
  };
  let authorizations: readonly PairedPhoneAuthorization[] = [];
  const publishedClaims: Array<{ readonly pairingId: string; readonly safetyCode: string }> = [];
  const gateway = createDirectRemoteGateway({
    installation,
    endpoints: () => [endpoint],
    clock: { now: () => now },
    randomBytes: (size) => randomBytes(size),
    authorizationStore: {
      list: async () => authorizations,
      replace: async (value) => void (authorizations = value),
    },
    approval: {
      publishClaim: (value) =>
        void publishedClaims.push({
          pairingId: value.pairingId,
          safetyCode: value.safetyCode,
        }),
    },
  });
  t.after(() => gateway.dispose());
  const WebSocket = createInMemoryDirectWebSocket({ gateway, endpoints: [endpoint] });
  const keys = new Map<string, object>();
  const profiles: DirectConnectionProfile[] = [];
  const controller = createMobileDirectPairingController({
    transport: createMobileDirectPairingWebSocketTransport({ WebSocket: WebSocket as never }),
    secureStore: {
      saveMachineKeys: async (machineId, value) => void keys.set(machineId, value),
      clearMachine: async (machineId) => void keys.delete(machineId),
    },
    profileStore: { save: async (profile) => void profiles.push(profile) },
    now: () => now,
  });

  const qrPayload = gateway.createPairing();
  const qrPending = await controller.beginQr({
    rawCode: JSON.stringify(qrPayload),
    displayName: "Phone QR",
    platform: "ios",
  });
  await waitForDirectCondition(() => gateway.getPairing(qrPayload.pairingId).state === "claimed");
  assert.equal(
    publishedClaims.find(({ pairingId }) => pairingId === qrPayload.pairingId)?.safetyCode,
    qrPending.safetyCode,
  );
  assert.equal(authorizations.length, 0);
  const qrComplete = qrPending.complete();
  await gateway.confirmPairing(qrPayload.pairingId, qrPending.safetyCode);
  const qrProfile = await qrComplete;
  assert.equal(qrProfile.machineId, installation.machineId);
  assert.equal(qrProfile.endpoints[0]?.host, endpoint.host);
  assert.equal(authorizations.length, 1);
  assert.ok(keys.has(installation.machineId));

  const manualPayload = gateway.createPairing();
  const manualPending = await controller.beginManual({
    host: endpoint.host,
    port: endpoint.port,
    manualCode: manualPayload.manualCode,
    displayName: "Phone Manual",
    platform: "android",
  });
  await waitForDirectCondition(
    () => gateway.getPairing(manualPayload.pairingId).state === "claimed",
  );
  assert.equal(
    publishedClaims.find(({ pairingId }) => pairingId === manualPayload.pairingId)?.safetyCode,
    manualPending.safetyCode,
  );
  const manualComplete = manualPending.complete();
  await gateway.confirmPairing(manualPayload.pairingId, manualPending.safetyCode);
  await manualComplete;
  assert.equal(authorizations.length, 2);
  assert.equal(profiles.length, 2);
  assert.equal(JSON.stringify({ authorizations, profiles }).includes("accountId"), false);
  assert.equal(JSON.stringify({ authorizations, profiles }).includes("relayOrigin"), false);
});
