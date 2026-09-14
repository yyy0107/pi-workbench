import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  openDirectRemoteEnvelope,
  type DirectEnvelopeCryptoError,
} from "@workbench/remote-control-contracts/direct-crypto";
import type { DirectSealedEnvelopeV1 } from "@workbench/remote-control-contracts/protocol";

interface NativeHpkeRuntimeResult {
  readonly status: "pass";
  readonly runtimeSource: "react-native-quick-crypto";
  readonly nodeToNativePlaintext: "node-to-native-react-native";
  readonly tamperRejected: true;
  readonly nativeToNodeEnvelope: DirectSealedEnvelopeV1;
}

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function verify(): Promise<void> {
  const raw = readFileSync(0, "utf8").trim();
  assert.ok(raw.length > 0, "native HPKE result is empty");
  assert.doesNotMatch(raw, /private(?:Key)?/iu, "native result must not expose a private key");

  const result = JSON.parse(raw) as NativeHpkeRuntimeResult;
  assert.equal(result.status, "pass");
  assert.equal(result.runtimeSource, "react-native-quick-crypto");
  assert.equal(result.nodeToNativePlaintext, "node-to-native-react-native");
  assert.equal(result.tamperRejected, true);

  const plaintext = await openDirectRemoteEnvelope({
    envelope: result.nativeToNodeEnvelope,
    expectedMachineId: "native-machine",
    expectedDeviceId: "native-device",
    expectedDirection: "mobile-to-desktop",
    senderPublicKey: fromHex(
      "04cd38ef80923e26f157e06c9887f80177c97e1005a41104127271237f946df22eda13d40801bce6184f1a631c44b0807a1a5e8d039975ed0f6079fcbd2dfe6652",
    ),
    associatedData: new TextEncoder().encode("native-interop-v1"),
    now: new Date("2026-09-13T00:01:00.000Z"),
    resolveRecipientPrivateKey: (keyId) =>
      keyId === "native-node-key"
        ? fromHex("6e7b14befe49443dc501def1cc2f0f293d9c5cfa045a23e9a2e0e7703b42705d")
        : undefined,
  });
  assert.equal(new TextDecoder().decode(plaintext), "native-react-native-to-node");
  console.info("Native React Native→Node HPKE verification PASS");
}

verify().catch((error: unknown) => {
  const typed = error as Partial<DirectEnvelopeCryptoError>;
  console.error(typed.code ? `Native HPKE verification failed: ${typed.code}` : error);
  process.exitCode = 1;
});
