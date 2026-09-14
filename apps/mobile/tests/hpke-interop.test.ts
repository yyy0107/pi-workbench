import assert from "node:assert/strict";
import test from "node:test";

import {
  generateDirectHpkeKeyPair,
  openDirectRemoteEnvelope,
  sealDirectRemoteEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";

import {
  initializeMobileHpkeRuntime,
  openMobileRemoteEnvelope,
  sealMobileRemoteEnvelope,
} from "../src/platform/crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const header = {
  protocolVersion: 1,
  envelopeId: "interop-envelope-1",
  machineId: "interop-machine-1",
  deviceId: "interop-device-1",
  direction: "mobile-to-desktop",
  contentType: "command",
  createdAt: "2026-09-13T20:00:00.000Z",
  expiresAt: "2026-09-13T20:02:00.000Z",
} as const;

test("Node seals and the mobile adapter opens an authenticated envelope", async () => {
  await initializeMobileHpkeRuntime();
  const node = await generateDirectHpkeKeyPair();
  const mobile = await generateDirectHpkeKeyPair();
  const envelope = await sealDirectRemoteEnvelope({
    header: { ...header, direction: "desktop-to-mobile" },
    recipient: { keyId: "mobile-key-1", publicKey: mobile.publicKey },
    senderPrivateKey: node.privateKey,
    plaintext: encoder.encode("node-to-mobile"),
  });

  const plaintext = await openMobileRemoteEnvelope({
    envelope,
    expectedMachineId: header.machineId,
    expectedDeviceId: header.deviceId,
    expectedDirection: "desktop-to-mobile",
    senderPublicKey: node.publicKey,
    now: new Date("2026-09-13T20:01:00.000Z"),
    resolveRecipientPrivateKey: (keyId) =>
      keyId === "mobile-key-1" ? mobile.privateKey : undefined,
  });
  assert.equal(decoder.decode(plaintext), "node-to-mobile");
});

test("the mobile adapter seals and Node opens an authenticated envelope", async () => {
  await initializeMobileHpkeRuntime();
  const mobile = await generateDirectHpkeKeyPair();
  const node = await generateDirectHpkeKeyPair();
  const envelope = await sealMobileRemoteEnvelope({
    header,
    recipient: { keyId: "desktop-key-1", publicKey: node.publicKey },
    senderPrivateKey: mobile.privateKey,
    plaintext: encoder.encode("mobile-to-node"),
  });

  const plaintext = await openDirectRemoteEnvelope({
    envelope,
    expectedMachineId: header.machineId,
    expectedDeviceId: header.deviceId,
    expectedDirection: "mobile-to-desktop",
    senderPublicKey: mobile.publicKey,
    now: new Date("2026-09-13T20:01:00.000Z"),
    resolveRecipientPrivateKey: (keyId) =>
      keyId === "desktop-key-1" ? node.privateKey : undefined,
  });
  assert.equal(decoder.decode(plaintext), "mobile-to-node");
});

test("fails closed when neither native nor standards-compliant WebCrypto is available", async () => {
  await assert.rejects(
    initializeMobileHpkeRuntime({
      forceNativeInstall: true,
      loadNativeCrypto: async () => ({ install() {} }),
      readCrypto: () => undefined,
    }),
    /development build with native WebCrypto support/u,
  );
});

test("the production entry can load the adapter without eagerly importing a native module", async () => {
  const module = await import("../src/platform/crypto");
  assert.equal(typeof module.initializeMobileHpkeRuntime, "function");
  assert.equal(typeof module.sealMobileRemoteEnvelope, "function");
  assert.equal(typeof module.openMobileRemoteEnvelope, "function");
});
