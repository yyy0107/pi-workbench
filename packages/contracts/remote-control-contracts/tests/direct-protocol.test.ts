import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDirectEndpointV1,
  parseDirectPairingHelloV1,
  parseDirectPairingClaimV1,
  parseDirectPairingPayloadV1,
  parseDirectPairingResultV1,
  parseDirectSealedEnvelopeV1,
  parseDirectSocketAuthenticateV1,
  parseDirectSocketAuthenticatedV1,
  parseDirectSocketChallengeV1,
} from "../src/codecs.ts";
import {
  generateDirectHpkeKeyPair,
  openDirectPairingEnvelope,
  openDirectRemoteEnvelope,
  sealDirectPairingEnvelope,
  sealDirectRemoteEnvelope,
} from "../src/direct-crypto.ts";
import {
  canonicalDirectPairingTranscript,
  canonicalDirectSocketAuthenticationTranscript,
  createDirectPairingExpiry,
} from "../src/direct-pairing.ts";

const endpoint = { kind: "local-network", host: "192.168.1.20", port: 8787 } as const;
const desktopIdentity = {
  machineId: "machine-1",
  machineDisplayName: "Workbench desktop",
  desktopEncryptionKeyId: "desktop-key-1",
  desktopEncryptionPublicKey: "A".repeat(87),
  desktopEncryptionKeyFingerprint: `sha256:${"a".repeat(43)}`,
} as const;
const expiresAt = "2026-09-13T12:02:00.000Z";

const pairing = {
  type: "workbench.remote.direct-pairing",
  version: 1,
  pairingId: "pairing-1",
  pairingSecret: "A".repeat(43),
  manualCode: "ABC23456",
  ...desktopIdentity,
  endpoints: [endpoint, { kind: "tailscale", host: "100.100.10.20", port: 8787 }],
  protocolRange: { min: 1, max: 1 },
  expiresAt,
} as const;

test("strictly parses direct LAN/Tailscale endpoints and account-free pairing payloads", () => {
  assert.deepEqual(parseDirectEndpointV1(endpoint), endpoint);
  assert.deepEqual(parseDirectPairingPayloadV1(pairing), pairing);
  assert.equal(parseDirectPairingPayloadV1({ ...pairing, accountId: "account-1" }), undefined);
  assert.equal(
    parseDirectPairingPayloadV1({ ...pairing, relayOrigin: "https://relay.test" }),
    undefined,
  );
  assert.equal(parseDirectPairingPayloadV1({ ...pairing, accessToken: "secret" }), undefined);
  assert.equal(parseDirectEndpointV1({ ...endpoint, host: "https://192.168.1.20" }), undefined);
  assert.equal(parseDirectEndpointV1({ ...endpoint, port: 0 }), undefined);
});

test("bounds and strictly parses the public pairing hello", () => {
  const hello = {
    type: "direct.pairing.hello",
    version: 1,
    pairingId: pairing.pairingId,
    ...desktopIdentity,
    endpoint,
    protocolRange: pairing.protocolRange,
    expiresAt,
  } as const;
  assert.deepEqual(parseDirectPairingHelloV1(hello), hello);
  assert.equal(
    parseDirectPairingHelloV1({ ...hello, pairingSecret: pairing.pairingSecret }),
    undefined,
  );
  assert.equal(
    parseDirectPairingHelloV1({ ...hello, machineDisplayName: "界".repeat(200) }),
    undefined,
  );
});

test("strictly parses a bounded direct claim and closed confirmation result", () => {
  const claim = {
    type: "direct.pairing.claim",
    pairingId: pairing.pairingId,
    secretProof: "S".repeat(43),
    deviceId: "phone-1",
    deviceDisplayName: "My phone",
    platform: "ios",
    mobileSigningPublicJwk: {
      kty: "EC",
      crv: "P-256",
      x: "A".repeat(43),
      y: "B".repeat(43),
      key_ops: ["verify"],
      ext: true,
    },
    mobileSigningKeyFingerprint: `sha256:${"b".repeat(43)}`,
    mobileEncryptionKeyId: "phone-encryption-1",
    mobileEncryptionPublicKey: "C".repeat(87),
    mobileEncryptionKeyFingerprint: `sha256:${"c".repeat(43)}`,
    transcriptProof: "P".repeat(86),
  } as const;
  assert.deepEqual(parseDirectPairingClaimV1(claim), claim);
  assert.equal(parseDirectPairingClaimV1({ ...claim, accountId: "account-1" }), undefined);
  assert.equal(parseDirectPairingClaimV1({ ...claim, platform: "web" }), undefined);

  const result = {
    type: "direct.pairing.result",
    pairingId: pairing.pairingId,
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
    desktopIdentity,
    approvedEndpoints: pairing.endpoints,
  } as const;
  assert.deepEqual(parseDirectPairingResultV1(result), result);
  assert.equal(parseDirectPairingResultV1({ ...result, scope: ["sessions.read"] }), undefined);
  assert.deepEqual(
    parseDirectPairingResultV1({
      type: "direct.pairing.result",
      pairingId: pairing.pairingId,
      state: "expired",
      code: "pairing_expired",
    }),
    {
      type: "direct.pairing.result",
      pairingId: pairing.pairingId,
      state: "expired",
      code: "pairing_expired",
    },
  );
});

test("enforces the two-minute direct invitation lifetime", () => {
  const createdAt = new Date("2026-09-13T12:00:00.000Z");
  assert.equal(createDirectPairingExpiry(createdAt), "2026-09-13T12:02:00.000Z");
  assert.throws(() => createDirectPairingExpiry(createdAt, 120_001), /two minutes/u);
});

test("binds direct pairing and socket authentication transcripts without accounts or Relay", () => {
  const direct = canonicalDirectPairingTranscript({
    pairingId: pairing.pairingId,
    secretProof: "proof-1",
    endpoint,
    ...desktopIdentity,
    phoneDeviceId: "phone-1",
    mobileEncryptionKeyId: "phone-encryption-1",
    mobileEncryptionKeyFingerprint: `sha256:${"b".repeat(43)}`,
    mobileSigningKeyFingerprint: `sha256:${"c".repeat(43)}`,
    protocolVersion: 1,
    expiresAt,
  });
  assert.match(direct, /workbench\.remote\.direct-pairing-transcript/u);
  assert.doesNotMatch(direct, /account|relay|token/iu);

  const authentication = canonicalDirectSocketAuthenticationTranscript({
    connectionId: "connection-1",
    nonce: "N".repeat(43),
    machineId: "machine-1",
    deviceId: "phone-1",
    authorizationRevision: "revision-1",
    endpoint,
    protocolVersion: 1,
    resume: { unresolvedOperationIds: ["operation-1"] },
    expiresAt: "2026-09-13T12:00:05.000Z",
  });
  assert.match(authentication, /direct-socket-authentication/u);
  assert.doesNotMatch(authentication, /account|relay|ticket|bearer/iu);
});

test("strictly parses direct challenge, authentication, and acknowledgement", () => {
  const challenge = {
    type: "direct.socket.challenge",
    version: 1,
    connectionId: "connection-1",
    nonce: "N".repeat(43),
    machineId: "machine-1",
    desktopEncryptionKeyId: "desktop-key-1",
    desktopEncryptionKeyFingerprint: desktopIdentity.desktopEncryptionKeyFingerprint,
    endpoint,
    protocolRange: { min: 1, max: 1 },
    expiresAt: "2026-09-13T12:00:05.000Z",
  } as const;
  assert.deepEqual(parseDirectSocketChallengeV1(challenge), challenge);
  assert.equal(parseDirectSocketChallengeV1({ ...challenge, ticket: "legacy-ticket" }), undefined);

  const authentication = {
    type: "direct.socket.authenticate",
    version: 1,
    connectionId: "connection-1",
    deviceId: "phone-1",
    authorizationRevision: "revision-1",
    protocolRange: { min: 1, max: 1 },
    resume: { unresolvedOperationIds: ["operation-1"] },
    challengeProof: "P".repeat(86),
  } as const;
  assert.deepEqual(parseDirectSocketAuthenticateV1(authentication), authentication);
  assert.equal(
    parseDirectSocketAuthenticateV1({ ...authentication, accountId: "account-1" }),
    undefined,
  );

  const acknowledgement = {
    type: "direct.socket.authenticated",
    version: 1,
    protocolVersion: 1,
    connectionId: "connection-1",
    machineId: "machine-1",
    machineDisplayName: "Workbench desktop",
    deviceId: "phone-1",
    authorizationRevision: "revision-1",
    epoch: "epoch-1",
  } as const;
  assert.deepEqual(parseDirectSocketAuthenticatedV1(acknowledgement), acknowledgement);
  assert.equal(
    parseDirectSocketAuthenticatedV1({
      ...acknowledgement,
      machineDisplayName: "界".repeat(200),
    }),
    undefined,
  );
  assert.equal(
    parseDirectSocketAuthenticatedV1({ ...acknowledgement, leaseGeneration: "legacy" }),
    undefined,
  );
});

test("accepts only direct sealed headers and enforces the aggregate ciphertext budget", () => {
  const envelope = {
    protocolVersion: 1,
    envelopeId: "envelope-1",
    machineId: "machine-1",
    deviceId: "phone-1",
    direction: "mobile-to-desktop",
    contentType: "command",
    keyId: "desktop-key-1",
    createdAt: "2026-09-13T12:00:00.000Z",
    expiresAt: "2026-09-13T12:00:30.000Z",
    hpke: {
      suite: "P256-HKDFSHA256-AES256GCM",
      enc: "AA",
      ciphertext: "AA",
    },
  } as const;
  assert.deepEqual(parseDirectSealedEnvelopeV1(envelope), envelope);
  assert.equal(
    parseDirectSealedEnvelopeV1({
      ...envelope,
      source: { kind: "mobile", id: "phone-1" },
      target: { kind: "desktop", id: "machine-1" },
    }),
    undefined,
  );
  assert.equal(
    parseDirectSealedEnvelopeV1({
      ...envelope,
      hpke: { ...envelope.hpke, ciphertext: "A".repeat(300 * 1024) },
    }),
    undefined,
  );
});

test("authenticates all direct routing headers as HPKE associated data", async () => {
  const sender = await generateDirectHpkeKeyPair();
  const recipient = await generateDirectHpkeKeyPair();
  const header = {
    protocolVersion: 1,
    envelopeId: "envelope-crypto-1",
    machineId: "machine-1",
    deviceId: "phone-1",
    direction: "mobile-to-desktop",
    contentType: "command",
    createdAt: "2026-09-13T12:00:00.000Z",
    expiresAt: "2026-09-13T12:00:30.000Z",
  } as const;
  const plaintext = new TextEncoder().encode('{"type":"session.catalog.read"}');
  const envelope = await sealDirectRemoteEnvelope({
    plaintext,
    header,
    recipient: { keyId: "desktop-key-1", publicKey: recipient.publicKey },
    senderPrivateKey: sender.privateKey,
  });
  assert.deepEqual(
    await openDirectRemoteEnvelope({
      envelope,
      expectedMachineId: "machine-1",
      expectedDeviceId: "phone-1",
      expectedDirection: "mobile-to-desktop",
      senderPublicKey: sender.publicKey,
      now: new Date("2026-09-13T12:00:01.000Z"),
      resolveRecipientPrivateKey: () => recipient.privateKey,
    }),
    plaintext,
  );
  await assert.rejects(
    openDirectRemoteEnvelope({
      envelope: { ...envelope, deviceId: "phone-2" },
      expectedMachineId: "machine-1",
      expectedDeviceId: "phone-2",
      expectedDirection: "mobile-to-desktop",
      senderPublicKey: sender.publicKey,
      now: new Date("2026-09-13T12:00:01.000Z"),
      resolveRecipientPrivateKey: () => recipient.privateKey,
    }),
    /authentication_failed/u,
  );
});

test("encrypts the bootstrap claim in HPKE Base mode before the sender key is known", async () => {
  const desktop = await generateDirectHpkeKeyPair();
  const plaintext = new TextEncoder().encode('{"type":"direct.pairing.claim"}');
  const envelope = await sealDirectPairingEnvelope({
    plaintext,
    header: {
      protocolVersion: 1,
      envelopeId: "pairing-envelope-1",
      machineId: "machine-1",
      deviceId: "phone-1",
      direction: "mobile-to-desktop",
      contentType: "pairing",
      createdAt: "2026-09-13T12:00:00.000Z",
      expiresAt: "2026-09-13T12:00:30.000Z",
    },
    recipient: { keyId: "desktop-key-1", publicKey: desktop.publicKey },
  });
  assert.deepEqual(
    await openDirectPairingEnvelope({
      envelope,
      expectedMachineId: "machine-1",
      expectedDeviceId: "phone-1",
      expectedDirection: "mobile-to-desktop",
      now: new Date("2026-09-13T12:00:01.000Z"),
      resolveRecipientPrivateKey: () => desktop.privateKey,
    }),
    plaintext,
  );
});
