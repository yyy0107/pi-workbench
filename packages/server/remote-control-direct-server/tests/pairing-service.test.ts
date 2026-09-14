import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { canonicalDirectPairingTranscript } from "@workbench/remote-control-contracts/direct-pairing";
import type {
  DirectEndpointV1,
  DirectPairingClaimV1,
} from "@workbench/remote-control-contracts/protocol";

import { createDirectPairingService, createDirectSecretProof } from "../src/pairing-service.ts";
import type { PairedPhoneAuthorization } from "../src/ports.ts";

const endpoint: DirectEndpointV1 = {
  kind: "local-network",
  host: "192.168.1.20",
  port: 8787,
};
const installation = {
  machineId: "machine-1",
  displayName: "Workbench desktop",
  encryptionKeyId: "desktop-key-1",
  encryptionPublicKey: "A".repeat(87),
  encryptionPrivateKey: "private-not-rendered",
  fingerprint: `sha256:${"a".repeat(43)}`,
  createdAt: "2026-09-13T12:00:00.000Z",
} as const;

function createFixture({ failSave = false } = {}) {
  let now = Date.parse("2026-09-13T12:00:00.000Z");
  let randomByte = 0;
  let authorizations: readonly PairedPhoneAuthorization[] = [];
  const published: unknown[] = [];
  const service = createDirectPairingService({
    installation,
    endpoints: () => [endpoint],
    clock: { now: () => new Date(now) },
    randomBytes: (size) => {
      randomByte = (randomByte + 17) % 256;
      return new Uint8Array(size).fill(randomByte);
    },
    authorizationStore: {
      list: async () => authorizations,
      replace: async (next) => {
        if (failSave) throw new Error("storage unavailable");
        authorizations = next;
      },
    },
    approval: { publishClaim: (claim) => published.push(claim) },
  });
  return {
    service,
    published,
    authorizations: () => authorizations,
    advance: (milliseconds: number) => (now += milliseconds),
  };
}

function createClaim(
  payload: ReturnType<ReturnType<typeof createFixture>["service"]["createInvitation"]>,
  method: "manual" | "qr",
) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicJwk = publicKey.export({ format: "jwk" });
  const secret = method === "manual" ? payload.manualCode : payload.pairingSecret;
  const secretProof = createDirectSecretProof(secret);
  const claimBase = {
    type: "direct.pairing.claim",
    pairingId: payload.pairingId,
    secretProof,
    deviceId: `phone-${method}`,
    deviceDisplayName: `Phone ${method}`,
    platform: "ios",
    mobileSigningPublicJwk: {
      kty: "EC",
      crv: "P-256",
      x: publicJwk.x!,
      y: publicJwk.y!,
      key_ops: ["verify"],
      ext: true,
    },
    mobileSigningKeyFingerprint: `sha256:${"b".repeat(43)}`,
    mobileEncryptionKeyId: `phone-encryption-${method}`,
    mobileEncryptionPublicKey: "C".repeat(87),
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
  const transcriptProof = sign("sha256", Buffer.from(transcript), privateKey).toString("base64url");
  return { ...claimBase, transcriptProof } satisfies DirectPairingClaimV1;
}

test("creates one-use QR and manual invitations without retaining recoverable secrets", () => {
  const value = createFixture();
  const payload = value.service.createInvitation();
  assert.equal(payload.type, "workbench.remote.direct-pairing");
  assert.equal(payload.expiresAt, "2026-09-13T12:02:00.000Z");
  assert.match(payload.manualCode, /^[A-HJ-NP-Z2-9]{8}$/u);
  assert.doesNotMatch(
    JSON.stringify(value.service.describe(payload.pairingId)),
    /pairingSecret|manualCode/u,
  );
  assert.deepEqual(value.service.getHello(endpoint), {
    type: "direct.pairing.hello",
    version: 1,
    pairingId: payload.pairingId,
    machineId: payload.machineId,
    machineDisplayName: payload.machineDisplayName,
    endpoint,
    desktopEncryptionKeyId: payload.desktopEncryptionKeyId,
    desktopEncryptionPublicKey: payload.desktopEncryptionPublicKey,
    desktopEncryptionKeyFingerprint: payload.desktopEncryptionKeyFingerprint,
    protocolRange: { min: 1, max: 1 },
    expiresAt: payload.expiresAt,
  });
});

for (const method of ["qr", "manual"] as const) {
  test(`claims and confirms an independently revocable authorization by ${method}`, async () => {
    const value = createFixture();
    const payload = value.service.createInvitation();
    const claim = createClaim(payload, method);
    const pending = await value.service.claim({ claim, endpoint });
    assert.match(pending.safetyCode, /^\d{3} \d{3}$/u);
    assert.deepEqual(value.published, [
      {
        pairingId: payload.pairingId,
        deviceId: claim.deviceId,
        deviceDisplayName: claim.deviceDisplayName,
        platform: "ios",
        safetyCode: pending.safetyCode,
        expiresAt: payload.expiresAt,
      },
    ]);

    const result = await value.service.confirm(payload.pairingId, pending.safetyCode);
    assert.equal(result.state, "confirmed");
    assert.equal(value.authorizations().length, 1);
    assert.equal(value.authorizations()[0]?.deviceId, claim.deviceId);
    assert.equal(value.service.describe(payload.pairingId).state, "consumed");
    await assert.rejects(value.service.claim({ claim, endpoint }), /pairing_unavailable/u);
  });
}

test("locks after five invalid proofs and expires at the exact deadline", async () => {
  const value = createFixture();
  const payload = value.service.createInvitation();
  const claim = { ...createClaim(payload, "qr"), secretProof: "X".repeat(43) };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(value.service.claim({ claim, endpoint }), /pairing_secret_invalid/u);
  }
  await assert.rejects(value.service.claim({ claim, endpoint }), /pairing_locked/u);
  assert.equal(value.service.describe(payload.pairingId).state, "locked");

  const expiring = value.service.createInvitation();
  value.advance(120_000);
  await assert.rejects(
    value.service.claim({ claim: createClaim(expiring, "manual"), endpoint }),
    /pairing_expired/u,
  );
});

test("serializes concurrent reuse and leaves confirmation retryable after persistence failure", async () => {
  const value = createFixture({ failSave: true });
  const payload = value.service.createInvitation();
  const claim = createClaim(payload, "qr");
  const [first, second] = await Promise.allSettled([
    value.service.claim({ claim, endpoint }),
    value.service.claim({ claim, endpoint }),
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  const safetyCode = first.status === "fulfilled" ? first.value.safetyCode : "";
  await assert.rejects(
    value.service.confirm(payload.pairingId, safetyCode),
    /storage unavailable/u,
  );
  assert.equal(value.service.describe(payload.pairingId).state, "claimed");
  assert.equal(value.authorizations().length, 0);
});

test("denial, cancellation, and process restart invalidate pending invitations", async () => {
  const denied = createFixture();
  const deniedPayload = denied.service.createInvitation();
  await denied.service.reject(deniedPayload.pairingId);
  assert.equal(denied.service.describe(deniedPayload.pairingId).state, "denied");

  const cancelledPayload = denied.service.createInvitation();
  denied.service.cancel(cancelledPayload.pairingId);
  assert.equal(denied.service.describe(cancelledPayload.pairingId).state, "cancelled");

  const restarted = createFixture();
  assert.throws(
    () => restarted.service.describe(cancelledPayload.pairingId),
    /pairing_unavailable/u,
  );
});
