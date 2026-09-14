import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parsePairingPayloadV1 } from "../src/legacy-codecs.ts";
import {
  PAIRING_DEFAULT_LIFETIME_MS,
  PAIRING_MAXIMUM_LIFETIME_MS,
  advancePairingState,
  assertPairingPayloadFresh,
  canonicalPairingTranscript,
  createPairingExpiry,
  derivePairingSafetyCode,
} from "../src/pairing.ts";

const createdAt = new Date("2026-09-13T20:00:00.000Z");
const payload = {
  type: "workbench.remote.pairing",
  version: 1,
  relayOrigin: "https://relay.example.test",
  pairingId: "pairing-1",
  pairingSecret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  machineId: "machine-1",
  desktopEncryptionKeyId: "desktop-key-1",
  desktopEncryptionPublicKey: "B".repeat(87),
  desktopEncryptionKeyFingerprint: "sha256:desktop-key-fingerprint",
  expiresAt: "2026-09-13T20:02:00.000Z",
} as const;

const transcriptInput = {
  accountId: "account-1",
  machineId: "machine-1",
  pairingId: "pairing-1",
  phoneDeviceId: "device-1",
  desktopEncryptionKeyId: "desktop-key-1",
  desktopEncryptionKeyFingerprint: "sha256:desktop-key-fingerprint",
  mobileEncryptionKeyId: "mobile-key-1",
  mobileEncryptionKeyFingerprint: "sha256:mobile-key-fingerprint",
  mobileSigningKeyFingerprint: "sha256:mobile-signing-fingerprint",
  protocolVersion: 1,
  expiresAt: payload.expiresAt,
} as const;

const digest = async (value: Uint8Array) =>
  Uint8Array.from(createHash("sha256").update(value).digest());

test("strictly parses the same entropy-bearing QR and manual pairing payload", () => {
  assert.deepEqual(parsePairingPayloadV1(payload), payload);
  assert.deepEqual(parsePairingPayloadV1(JSON.parse(JSON.stringify(payload))), payload);
  for (const invalid of [
    { ...payload, type: "workbench.remote.tool" },
    { ...payload, pairingSecret: "too-short" },
    { ...payload, relayOrigin: "http://relay.example.test" },
    { ...payload, relayOrigin: "https://user:pass@relay.example.test" },
    { ...payload, desktopEncryptionPublicKey: "not base64url+" },
    { ...payload, extra: "field" },
  ]) {
    assert.equal(parsePairingPayloadV1(invalid), undefined);
  }
});

test("uses a two-minute default and enforces a five-minute hard maximum", () => {
  assert.equal(PAIRING_DEFAULT_LIFETIME_MS, 2 * 60_000);
  assert.equal(PAIRING_MAXIMUM_LIFETIME_MS, 5 * 60_000);
  assert.equal(createPairingExpiry(createdAt), "2026-09-13T20:02:00.000Z");
  assert.equal(createPairingExpiry(createdAt, 5 * 60_000), "2026-09-13T20:05:00.000Z");
  assert.throws(() => createPairingExpiry(createdAt, 5 * 60_000 + 1), /five minutes/u);
  assert.doesNotThrow(() =>
    assertPairingPayloadFresh(payload, new Date("2026-09-13T20:01:59.999Z")),
  );
  assert.throws(
    () => assertPairingPayloadFresh(payload, new Date("2026-09-13T20:02:00.000Z")),
    /expired/u,
  );
});

test("binds account, machine, device, both keys, protocol, and expiry into the safety code", async () => {
  const transcript = canonicalPairingTranscript(transcriptInput);
  const original = await derivePairingSafetyCode(transcript, digest);
  assert.match(original, /^\d{3} \d{3}$/u);

  for (const replacement of [
    { accountId: "account-2" },
    { machineId: "machine-2" },
    { phoneDeviceId: "device-2" },
    { desktopEncryptionKeyFingerprint: "sha256:substituted-desktop" },
    { mobileEncryptionKeyFingerprint: "sha256:substituted-mobile" },
    { mobileSigningKeyFingerprint: "sha256:substituted-signing" },
    { expiresAt: "2026-09-13T20:03:00.000Z" },
  ]) {
    const changed = await derivePairingSafetyCode(
      canonicalPairingTranscript({ ...transcriptInput, ...replacement }),
      digest,
    );
    assert.notEqual(changed, original);
  }
});

test("rejects duplicate, expired, or post-denial pairing state transitions", () => {
  assert.equal(advancePairingState("created", "claim"), "claimed");
  assert.equal(advancePairingState("claimed", "confirm"), "consumed");
  assert.equal(advancePairingState("claimed", "reject"), "denied");
  assert.equal(advancePairingState("created", "expire"), "expired");
  for (const [state, event] of [
    ["claimed", "claim"],
    ["consumed", "confirm"],
    ["denied", "claim"],
    ["expired", "claim"],
  ] as const) {
    assert.throws(() => advancePairingState(state, event), /invalid pairing transition/u);
  }
});
