import type { DirectSealedEnvelopeV1 } from "@workbench/remote-control-contracts/protocol";
import { registerRootComponent } from "expo";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";

import {
  initializeMobileHpkeRuntime,
  openMobileRemoteEnvelope,
  sealMobileRemoteEnvelope,
} from "../src/platform/crypto.ts";

const RESULT_MARKER = "WORKBENCH_NATIVE_HPKE_RESULT:";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// These are public RFC-derived test fixtures, never production credentials. This
// file is only bundled when Gradle receives ENTRY_FILE=tests/native-hpke-runtime-entry.ts.
const mobilePrivateKey = fromHex(
  "d9f10996a02cd6c9dbda1d1f225f18f781ea3c893b8c2a6cb2e266e59f3cd9a9",
);
const nodePublicKey = fromHex(
  "04ece9b48cc98ee03ba742fe1218a3fbec960cc34b6e1defdcd3285276f39028e95b90f9526607565888766a1101f429dc3ec87364b5c8c613f0a081881950427f",
);
const associatedData = encoder.encode("native-interop-v1");

const nodeToNativeEnvelope: DirectSealedEnvelopeV1 = {
  protocolVersion: 1,
  envelopeId: "native-node-to-mobile",
  machineId: "native-machine",
  deviceId: "native-device",
  direction: "desktop-to-mobile",
  contentType: "event",
  createdAt: "2026-09-13T00:00:00.000Z",
  expiresAt: "2099-09-13T00:00:00.000Z",
  keyId: "native-mobile-key",
  hpke: {
    suite: "P256-HKDFSHA256-AES256GCM",
    enc: "BNnswlqE1j5eY29hyzdzypXYhMOTdCiNnHLZQy8sYMFQk8b5VYvyZYGmlM38FpdiS0MoldfIguLk7rw_u4cI_64",
    ciphertext: "PQ7-HH05n5vye0Y7KVRGbbw7R_CpUk8pLrB4F-30U4QlpCUGWH8FLpMnEA",
  },
};

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function mutateBase64Url(value: string): string {
  return `${value.slice(0, -1)}${value.at(-1) === "A" ? "B" : "A"}`;
}

async function runNativeHpkeInterop(): Promise<string> {
  const runtimeSource = await initializeMobileHpkeRuntime({ forceNativeInstall: true });
  if (runtimeSource !== "react-native-quick-crypto") {
    throw new Error(`Unexpected crypto source: ${runtimeSource}`);
  }

  const plaintext = await openMobileRemoteEnvelope({
    envelope: nodeToNativeEnvelope,
    expectedMachineId: "native-machine",
    expectedDeviceId: "native-device",
    expectedDirection: "desktop-to-mobile",
    senderPublicKey: nodePublicKey,
    associatedData,
    now: new Date("2026-09-13T00:01:00.000Z"),
    resolveRecipientPrivateKey: (keyId) =>
      keyId === "native-mobile-key" ? mobilePrivateKey : undefined,
  });
  const nodeToNativePlaintext = decoder.decode(plaintext);
  if (nodeToNativePlaintext !== "node-to-native-react-native") {
    throw new Error("Node-to-native plaintext mismatch");
  }

  let tamperRejected = false;
  try {
    await openMobileRemoteEnvelope({
      envelope: {
        ...nodeToNativeEnvelope,
        hpke: {
          ...nodeToNativeEnvelope.hpke,
          ciphertext: mutateBase64Url(nodeToNativeEnvelope.hpke.ciphertext),
        },
      },
      expectedMachineId: "native-machine",
      expectedDeviceId: "native-device",
      expectedDirection: "desktop-to-mobile",
      senderPublicKey: nodePublicKey,
      associatedData,
      now: new Date("2026-09-13T00:01:00.000Z"),
      resolveRecipientPrivateKey: () => mobilePrivateKey,
    });
  } catch {
    tamperRejected = true;
  }
  if (!tamperRejected) throw new Error("Tampered ciphertext was accepted");

  const nativeToNodeEnvelope = await sealMobileRemoteEnvelope({
    header: {
      protocolVersion: 1,
      envelopeId: "native-mobile-to-node",
      machineId: "native-machine",
      deviceId: "native-device",
      direction: "mobile-to-desktop",
      contentType: "command",
      createdAt: "2026-09-13T00:00:00.000Z",
      expiresAt: "2099-09-13T00:00:00.000Z",
    },
    recipient: { keyId: "native-node-key", publicKey: nodePublicKey },
    senderPrivateKey: mobilePrivateKey,
    plaintext: encoder.encode("native-react-native-to-node"),
    associatedData,
  });

  const result = JSON.stringify({
    status: "pass",
    runtimeSource,
    nodeToNativePlaintext,
    tamperRejected,
    nativeToNodeEnvelope,
  });
  console.info(`${RESULT_MARKER}${result}`);
  return "PASS";
}

function NativeHpkeRuntimeHarness() {
  const [status, setStatus] = useState("RUNNING");

  useEffect(() => {
    void runNativeHpkeInterop().then(setStatus, (error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`${RESULT_MARKER}${JSON.stringify({ status: "fail", message })}`);
      setStatus("FAIL");
    });
  }, []);

  return React.createElement(
    View,
    { accessibilityLabel: "Native HPKE interoperability harness" },
    React.createElement(Text, null, `Native HPKE: ${status}`),
  );
}

registerRootComponent(NativeHpkeRuntimeHarness);
