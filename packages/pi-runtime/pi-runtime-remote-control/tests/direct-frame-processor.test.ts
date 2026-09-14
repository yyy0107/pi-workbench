import assert from "node:assert/strict";
import test from "node:test";

import { parseRemoteControlResponseV1 } from "@workbench/remote-control-contracts/codecs";
import {
  generateDirectHpkeKeyPair,
  openDirectRemoteEnvelope,
  sealDirectRemoteEnvelope,
} from "@workbench/remote-control-contracts/direct-crypto";
import type {
  DirectSealedEnvelopeV1,
  RemoteAction,
  RemoteControlRequestV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import { createRemoteCommandAdapter } from "../src/command-adapter.ts";
import {
  createDesktopDirectFrameProcessor,
  type DirectFrameAuthorization,
} from "../src/direct-frame-processor.ts";
import {
  createRemoteOperationLedger,
  type RemoteOperationLedgerRecord,
  type RemoteOperationLedgerStorePort,
} from "../src/operation-ledger.ts";

const now = new Date("2030-09-14T20:00:00.000Z");
const actions: readonly RemoteAction[] = [
  "sessions.read",
  "sessions.create",
  "sessions.send",
  "sessions.stop",
  "sessions.organize",
  "interactions.respond",
];

function encoded(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function memoryLedgerStore(): RemoteOperationLedgerStorePort {
  const values = new Map<string, RemoteOperationLedgerRecord>();
  const key = (value: { readonly deviceId: string; readonly operationId: string }) =>
    `${value.deviceId}:${value.operationId}`;
  return {
    get: async (input) => values.get(key(input)),
    async insertAccepted(value) {
      const identity = key(value);
      if (values.has(identity)) return false;
      values.set(identity, value);
      return true;
    },
    async finish(input) {
      const identity = key(input);
      const current = values.get(identity);
      if (!current) return undefined;
      const result: RemoteOperationLedgerRecord = {
        ...current,
        state: input.result.state,
        result: input.result,
        finishedAt: input.finishedAt,
      };
      values.set(identity, result);
      return result;
    },
    listIncomplete: async () => [...values.values()].filter(({ state }) => state === "accepted"),
    listCompleted: async () => [...values.values()].filter(({ state }) => state !== "accepted"),
    prune: async () => 0,
    close() {},
  };
}

test("opens mobile direct HPKE frames and seals responses only for the current authorization", async (t) => {
  const [desktopKeys, mobileKeys] = await Promise.all([
    generateDirectHpkeKeyPair(),
    generateDirectHpkeKeyPair(),
  ]);
  const installation = {
    machineId: "machine-direct-1",
    encryptionKeyId: "desktop-direct-key-1",
    encryptionPrivateKey: encoded(desktopKeys.privateKey),
  } as const;
  const active: DirectFrameAuthorization = {
    deviceId: "device-direct-1",
    displayName: "Phone",
    platform: "ios",
    signingPublicKey: {
      kty: "EC",
      crv: "P-256",
      x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      y: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
    signingKeyFingerprint: "sha256:signing",
    encryptionKeyId: "mobile-direct-key-1",
    encryptionPublicKey: encoded(mobileKeys.publicKey),
    encryptionKeyFingerprint: "sha256:encryption",
    scope: actions,
    revision: "authorization-1",
    createdAt: now.toISOString(),
  };
  let persisted: readonly DirectFrameAuthorization[] = [active];
  const session: RemoteSessionSummaryV1 = {
    sessionId: "session-1",
    workspace: { workspaceId: "workspace-1", displayName: "Project" },
    title: "Direct session",
    updatedAt: now.toISOString(),
    pinned: false,
    archived: false,
    attention: "none",
    runState: "idle",
    entityRevision: "session-revision-1",
  };
  const ledger = createRemoteOperationLedger({
    machineId: installation.machineId,
    clock: { now: () => now },
    store: memoryLedgerStore(),
  });
  t.after(() => ledger.close());
  const processor = createDesktopDirectFrameProcessor({
    installation,
    epoch: "epoch-direct-1",
    clock: { now: () => now },
    id: (() => {
      let value = 0;
      return () => `direct-frame-${++value}`;
    })(),
    loadAuthorizations: async () => persisted,
    ledger,
    commands: createRemoteCommandAdapter({
      runtime: {
        history: async () => ({ events: [], hasMore: false }),
        prompt: async (input) => ({
          accepted: true,
          queued: false,
          messageId: input.clientMutation.messageId,
        }),
        cancel: async () => ({ accepted: true }),
        answerQuestion: async () => ({ accepted: true }),
      },
    }),
    readSessionCatalog: async () => [session],
  });
  t.after(() => processor.close());
  await processor.initialize();

  const output: DirectSealedEnvelopeV1[] = [];
  const subscription = processor.subscribe(active, async (frame) => void output.push(frame));
  t.after(() => subscription.dispose());
  const request: RemoteControlRequestV1 = {
    type: "control.request",
    requestId: "catalog-1",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    query: { type: "session.catalog.read" },
  };
  const envelope = await sealDirectRemoteEnvelope({
    plaintext: new TextEncoder().encode(JSON.stringify(request)),
    header: {
      protocolVersion: 1,
      envelopeId: "mobile-envelope-1",
      machineId: installation.machineId,
      deviceId: active.deviceId,
      direction: "mobile-to-desktop",
      contentType: "command",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    },
    recipient: { keyId: installation.encryptionKeyId, publicKey: desktopKeys.publicKey },
    senderPrivateKey: mobileKeys.privateKey,
  });

  await processor.process({ authorization: active, envelope });
  assert.equal(output.length, 1);
  const plaintext = await openDirectRemoteEnvelope({
    envelope: output[0],
    expectedMachineId: installation.machineId,
    expectedDeviceId: active.deviceId,
    expectedDirection: "desktop-to-mobile",
    senderPublicKey: desktopKeys.publicKey,
    now,
    resolveRecipientPrivateKey: (keyId) =>
      keyId === active.encryptionKeyId ? mobileKeys.privateKey : undefined,
  });
  const response = parseRemoteControlResponseV1(
    JSON.parse(new TextDecoder().decode(plaintext)) as unknown,
  );
  assert.equal(response?.requestId, request.requestId);
  assert.ok(response && "value" in response && response.value.type === "session.catalog");
  assert.equal(
    response && "value" in response && response.value.type === "session.catalog"
      ? response.value.sessions[0]?.sessionId
      : undefined,
    session.sessionId,
  );

  const revoked: DirectFrameAuthorization = {
    ...active,
    revision: "authorization-2",
    revokedAt: new Date(now.getTime() + 1).toISOString(),
  };
  persisted = [revoked];
  await processor.refreshAuthorizations();
  await assert.rejects(processor.process({ authorization: revoked, envelope }), /device_revoked/u);
});
