import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test, { type TestContext } from "node:test";

import { generateDirectHpkeKeyPair } from "../packages/contracts/remote-control-contracts/src/direct-crypto.ts";
import type {
  RemoteAction,
  RemoteCommandV1,
  RemoteOperationRequestV1,
  RemoteSessionSummaryV1,
} from "../packages/contracts/remote-control-contracts/src/protocol.ts";
import { createRemoteCommandAdapter } from "../packages/pi-runtime/pi-runtime-remote-control/src/command-adapter.ts";
import { createDesktopDirectFrameProcessor } from "../packages/pi-runtime/pi-runtime-remote-control/src/direct-frame-processor.ts";
import {
  createRemoteOperationLedger,
  type RemoteOperationLedgerRecord,
  type RemoteOperationLedgerStorePort,
} from "../packages/pi-runtime/pi-runtime-remote-control/src/operation-ledger.ts";
import { createDirectRemoteGateway } from "../packages/server/remote-control-direct-server/src/gateway.ts";
import type { PairedPhoneAuthorization } from "../packages/server/remote-control-direct-server/src/ports.ts";
import { createDirectConnectionProfile } from "../packages/transport/remote-control-client/src/profiles.ts";
import type { MobileDirectPairingPrivateIdentity } from "../apps/mobile/src/features/direct-pairing.ts";
import { createMobileProjectionStore } from "../apps/mobile/src/state/projection-store.ts";
import { createMobileRemoteTransport } from "../apps/mobile/src/state/remote-transport.ts";
import {
  createInMemoryDirectWebSocket,
  waitForDirectCondition,
} from "./remote-control-direct-integration-harness.ts";

const now = new Date("2030-09-14T20:00:00.000Z");
const endpoint = { kind: "tailscale", host: "100.64.0.8", port: 8787 } as const;
const actions: readonly RemoteAction[] = [
  "sessions.read",
  "sessions.create",
  "sessions.send",
  "sessions.stop",
  "sessions.organize",
  "interactions.respond",
];

function memoryLedgerStore(): RemoteOperationLedgerStorePort {
  const values = new Map<string, RemoteOperationLedgerRecord>();
  const key = (value: { readonly deviceId: string; readonly operationId: string }) =>
    `${value.deviceId}:${value.operationId}`;
  return {
    get: async (input) => values.get(key(input)),
    async insertAccepted(record) {
      const identity = key(record);
      if (values.has(identity)) return false;
      values.set(identity, record);
      return true;
    },
    async finish(input) {
      const identity = key(input);
      const current = values.get(identity);
      if (!current) return undefined;
      const value: RemoteOperationLedgerRecord = {
        ...current,
        state: input.result.state,
        result: input.result,
        finishedAt: input.finishedAt,
      };
      values.set(identity, value);
      return value;
    },
    listIncomplete: async (machineId) =>
      [...values.values()].filter(
        (value) => value.machineId === machineId && value.state === "accepted",
      ),
    listCompleted: async (machineId) =>
      [...values.values()].filter(
        (value) => value.machineId === machineId && value.state !== "accepted",
      ),
    prune: async () => 0,
    close() {},
  };
}

async function fixture(t: TestContext) {
  const [desktopKeys, mobileKeys, signingKeys] = await Promise.all([
    generateDirectHpkeKeyPair(),
    generateDirectHpkeKeyPair(),
    globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]) as Promise<CryptoKeyPair>,
  ]);
  const [signingPrivateJwk, signingPublicJwk] = await Promise.all([
    globalThis.crypto.subtle.exportKey("jwk", signingKeys.privateKey),
    globalThis.crypto.subtle.exportKey("jwk", signingKeys.publicKey),
  ]);
  if (!signingPublicJwk.x || !signingPublicJwk.y) throw new Error("signing_key_invalid");
  const encodedDesktopPublic = Buffer.from(desktopKeys.publicKey).toString("base64url");
  const encodedMobilePublic = Buffer.from(mobileKeys.publicKey).toString("base64url");
  const installation = {
    machineId: "machine-closed-loop",
    displayName: "Tailscale Workbench",
    encryptionKeyId: "desktop-key-closed-loop",
    encryptionPublicKey: encodedDesktopPublic,
    encryptionPrivateKey: Buffer.from(desktopKeys.privateKey).toString("base64url"),
    fingerprint: `sha256:${createHash("sha256").update(desktopKeys.publicKey).digest("base64url")}`,
    createdAt: now.toISOString(),
  };
  const identity: MobileDirectPairingPrivateIdentity = {
    deviceId: "phone-closed-loop",
    signingPrivateJwk,
    signingPublicJwk: {
      kty: "EC",
      crv: "P-256",
      x: signingPublicJwk.x,
      y: signingPublicJwk.y,
      key_ops: ["verify"],
      ext: true,
    },
    signingKeyFingerprint: "sha256:mobile-signing-key",
    encryptionKeyId: "mobile-key-closed-loop",
    encryptionPrivateKey: Buffer.from(mobileKeys.privateKey).toString("base64url"),
    encryptionPublicKey: encodedMobilePublic,
    encryptionKeyFingerprint: `sha256:${createHash("sha256").update(mobileKeys.publicKey).digest("base64url")}`,
  };
  const activeAuthorization: PairedPhoneAuthorization = {
    deviceId: identity.deviceId,
    displayName: "Integration Phone",
    platform: "android",
    signingPublicKey: identity.signingPublicJwk,
    signingKeyFingerprint: identity.signingKeyFingerprint,
    encryptionKeyId: identity.encryptionKeyId,
    encryptionPublicKey: identity.encryptionPublicKey,
    encryptionKeyFingerprint: identity.encryptionKeyFingerprint,
    scope: actions,
    revision: "authorization-closed-loop-1",
    createdAt: now.toISOString(),
  };
  let authorizations: readonly PairedPhoneAuthorization[] = [activeAuthorization];
  let revision = 1;
  let promptEffects = 0;
  let stopEffects = 0;
  let answerEffects = 0;
  const sessions = new Map<
    string,
    { title: string; pinned: boolean; archived: boolean; entityRevision: string }
  >([
    [
      "session-1",
      {
        title: "Existing session",
        pinned: false,
        archived: false,
        entityRevision: "entity-1",
      },
    ],
  ]);
  const updateSession = (
    sessionId: string,
    patch: Partial<{ title: string; pinned: boolean; archived: boolean }>,
  ) => {
    const current = sessions.get(sessionId);
    if (!current)
      throw Object.assign(new Error("operation_not_found"), { code: "operation_not_found" });
    const next = { ...current, ...patch, entityRevision: `entity-${++revision}` };
    sessions.set(sessionId, next);
    return { sessionId, ...next };
  };
  const sessionCatalog = (): readonly RemoteSessionSummaryV1[] =>
    [...sessions]
      .filter(([, value]) => !value.archived)
      .map(([sessionId, value]) => ({
        sessionId,
        workspace: { workspaceId: "workspace-1", displayName: "Project" },
        title: value.title,
        updatedAt: now.toISOString(),
        pinned: value.pinned,
        archived: value.archived,
        attention: sessionId === "session-1" ? "input-needed" : "none",
        runState: "idle",
        entityRevision: value.entityRevision,
      }));
  const runtime = {
    history: async () => ({
      events: [
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: now.toISOString(),
          content: [{ type: "text", text: "Direct encrypted response" }],
        },
        {
          type: "question/requested",
          rpcId: "question-1",
          revision: "question-revision-1",
          expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
          questions: [
            {
              id: "continue",
              question: "Continue?",
              options: [
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ],
            },
          ],
        },
      ],
      hasMore: false,
    }),
    prompt: async (input: { readonly clientMutation: { readonly messageId: string } }) => {
      promptEffects += 1;
      return {
        accepted: true as const,
        queued: false as const,
        messageId: input.clientMutation.messageId,
      };
    },
    cancel: async () => {
      stopEffects += 1;
      return { accepted: true as const };
    },
    answerQuestion: async () => {
      answerEffects += 1;
      return { accepted: true as const };
    },
    listWorkspaces: async () => [{ workspaceId: "workspace-1", displayName: "Project" }],
    getSessionState: async (sessionId: string) => {
      const value = sessions.get(sessionId);
      return value ? { sessionId, ...value } : undefined;
    },
    createSession: async ({ requestedSessionId }: { readonly requestedSessionId: string }) => {
      sessions.set(requestedSessionId, {
        title: "New session",
        pinned: false,
        archived: false,
        entityRevision: `entity-${++revision}`,
      });
      return { sessionId: requestedSessionId };
    },
    renameSession: async ({
      sessionId,
      title,
    }: {
      readonly sessionId: string;
      readonly title: string;
    }) => updateSession(sessionId, { title }),
    setSessionPinned: async ({
      sessionId,
      pinned,
    }: {
      readonly sessionId: string;
      readonly pinned: boolean;
    }) => updateSession(sessionId, { pinned }),
    archiveSession: async ({ sessionId }: { readonly sessionId: string }) =>
      updateSession(sessionId, { archived: true }),
  };
  const ledger = createRemoteOperationLedger({
    machineId: installation.machineId,
    clock: { now: () => now },
    store: memoryLedgerStore(),
  });
  t.after(() => ledger.close());
  const processor = createDesktopDirectFrameProcessor({
    installation,
    epoch: "epoch-closed-loop",
    clock: { now: () => now },
    id: (() => {
      let value = 0;
      return () => `desktop-${++value}`;
    })(),
    loadAuthorizations: async () => authorizations,
    ledger,
    commands: createRemoteCommandAdapter({ runtime }),
    readSessionCatalog: async () => sessionCatalog(),
  });
  await processor.initialize();
  t.after(() => processor.close());
  const gateway = createDirectRemoteGateway({
    installation,
    endpoints: () => [endpoint],
    clock: { now: () => now },
    randomBytes: (size) => randomBytes(size),
    authorizationStore: {
      list: async () => authorizations,
      replace: async (value) => void (authorizations = value),
    },
    approval: { publishClaim() {} },
    business: processor,
    epoch: "epoch-closed-loop",
  });
  t.after(() => gateway.dispose());
  const profile = createDirectConnectionProfile({
    desktop: {
      machineId: installation.machineId,
      machineDisplayName: installation.displayName,
      desktopEncryptionKeyId: installation.encryptionKeyId,
      desktopEncryptionPublicKey: installation.encryptionPublicKey,
      desktopEncryptionKeyFingerprint: installation.fingerprint,
    },
    deviceId: identity.deviceId,
    authorizationRevision: activeAuthorization.revision,
    endpoints: [endpoint],
    approvedAt: now.toISOString(),
  });
  let projectionValue:
    | {
        readonly sessions: readonly RemoteSessionSummaryV1[];
        readonly cursor: { readonly epoch: string; readonly offset: string };
        readonly stale: boolean;
      }
    | undefined;
  const projection = createMobileProjectionStore({
    persistence: {
      load: async () => projectionValue,
      replace: async (_machineId, value) => void (projectionValue = value),
      markStale: async () => {
        if (projectionValue) projectionValue = { ...projectionValue, stale: true };
      },
    },
  });
  let lifecycleListener: ((state: "active" | "background") => void) | undefined;
  const WebSocket = createInMemoryDirectWebSocket({ gateway, endpoints: [endpoint] });
  const transport = createMobileRemoteTransport({
    secureStore: { loadMachineKeys: async <T extends object>() => identity as unknown as T },
    profileStore: { get: async () => profile, noteEndpointSuccess: async () => {} },
    projection,
    lifecycle: {
      current: () => "active",
      subscribe: (listener) => {
        lifecycleListener = listener;
        return () => void (lifecycleListener = undefined);
      },
    },
    network: {
      current: async () => ({ connected: true, reachable: true }),
      subscribe: () => () => {},
    },
    WebSocket: WebSocket as never,
    clock: { now: () => now },
    id: (() => {
      let value = 0;
      return () => `mobile-${++value}`;
    })(),
  });
  await transport.start();
  t.after(() => transport.stop());
  return {
    activeAuthorization,
    gateway,
    processor,
    profile,
    transport,
    sessions,
    lifecycle: (state: "active" | "background") => lifecycleListener?.(state),
    projection: () => projectionValue,
    effects: () => ({ promptEffects, stopEffects, answerEffects }),
    revoke: async () => {
      authorizations = [
        {
          ...activeAuthorization,
          revision: "authorization-closed-loop-2",
          revokedAt: new Date(now.getTime() + 1).toISOString(),
        },
      ];
      await processor.refreshAuthorizations();
      gateway.revokeDevice(activeAuthorization.deviceId);
    },
  };
}

function request(operationId: string, command: RemoteCommandV1): RemoteOperationRequestV1 {
  return {
    type: "operation.request",
    operationId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    command,
  };
}

test("controls multiple sessions through the production direct gateway and mobile transport", async (t) => {
  const value = await fixture(t);
  const initial = await value.transport.read(value.profile.machineId);
  assert.deepEqual(
    initial.map(({ sessionId }) => sessionId),
    ["session-1"],
  );
  assert.equal(value.projection()?.stale, false);
  const history = await value.transport.readHistory({
    machineId: value.profile.machineId,
    sessionId: "session-1",
  });
  assert.ok(history.items.some((item) => item.type === "assistant-message"));
  assert.ok(history.items.some((item) => item.type === "ordinary-question"));

  const send = request("operation-send", {
    type: "session.send",
    sessionId: "session-1",
    text: "Continue from phone",
  });
  assert.equal(
    (await value.transport.submit({ machineId: value.profile.machineId, request: send })).state,
    "succeeded",
  );
  assert.equal(
    (await value.transport.submit({ machineId: value.profile.machineId, request: send })).state,
    "succeeded",
  );
  assert.equal(value.effects().promptEffects, 1);

  for (const operation of [
    request("operation-stop", { type: "session.stop", sessionId: "session-1" }),
    request("operation-rename", {
      type: "session.rename",
      sessionId: "session-1",
      title: "Renamed remotely",
    }),
    request("operation-pin", {
      type: "session.setPinned",
      sessionId: "session-1",
      pinned: true,
    }),
    request("operation-question", {
      type: "interaction.answerQuestion",
      sessionId: "session-1",
      interactionId: "question-1",
      interactionRevision: "question-revision-1",
      answers: [{ questionId: "continue", optionIds: ["yes"] }],
    }),
    request("operation-create", {
      type: "session.create",
      workspaceId: "workspace-1",
      title: "Created remotely",
    }),
    request("operation-archive", {
      type: "session.setArchived",
      sessionId: "session-1",
      archived: true,
    }),
  ]) {
    const result = await value.transport.submit({
      machineId: value.profile.machineId,
      request: operation,
    });
    assert.equal(result.state, "succeeded", `${operation.command.type}:${result.code ?? "ok"}`);
  }
  assert.deepEqual(value.effects(), { promptEffects: 1, stopEffects: 1, answerEffects: 1 });
  assert.equal(value.sessions.get("session-1")?.title, "Renamed remotely");
  assert.equal(value.sessions.get("session-1")?.pinned, true);
  assert.equal(value.sessions.get("session-1")?.archived, true);
  assert.equal(value.sessions.get("operation-create")?.title, "Created remotely");
  assert.equal(
    (
      await value.transport.recoverOperations({
        machineId: value.profile.machineId,
        operationIds: ["operation-send"],
      })
    )[0]?.state,
    "succeeded",
  );

  value.lifecycle("background");
  await waitForDirectCondition(() => value.projection()?.stale === true);
  value.lifecycle("active");
  const reconnected = await value.transport.read(value.profile.machineId);
  assert.deepEqual(
    reconnected.map(({ sessionId }) => sessionId),
    ["operation-create"],
  );

  await value.revoke();
  await assert.rejects(() => value.transport.read(value.profile.machineId), /device_revoked/u);
  assert.equal(JSON.stringify(value.projection()).includes("tool"), false);
});
