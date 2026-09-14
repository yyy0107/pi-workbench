import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  parseRemoteControlResponseV1,
  parseRemoteOperationResultV1,
  parseRemoteSnapshotChunkV1,
  parseRemoteSnapshotCompleteV1,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteAction,
  RemoteControlRequestV1,
  RemoteOperationRequestV1,
  RemoteSealedContentType,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import { createRemoteCommandAdapter } from "../src/command-adapter.ts";
import { createDesktopRemoteFrameProcessor } from "../src/frame-processor.ts";
import {
  createRemoteOperationLedger,
  type RemoteOperationLedgerRecord,
  type RemoteOperationLedgerStorePort,
} from "../src/operation-ledger.ts";

const now = new Date("2030-09-13T20:00:00.000Z");
const ALL_ACTIONS: readonly RemoteAction[] = [
  "sessions.read",
  "sessions.create",
  "sessions.send",
  "sessions.stop",
  "sessions.organize",
  "interactions.respond",
];

function memoryLedgerStore(): RemoteOperationLedgerStorePort {
  const values = new Map<string, RemoteOperationLedgerRecord>();
  const key = (deviceId: string, operationId: string) => `${deviceId}:${operationId}`;
  return {
    get: async (input) => values.get(key(input.deviceId, input.operationId)),
    async insertAccepted(value) {
      const identity = key(value.deviceId, value.operationId);
      if (values.has(identity)) return false;
      values.set(identity, value);
      return true;
    },
    async finish(input) {
      const identity = key(input.deviceId, input.operationId);
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
    listIncomplete: async () => [...values.values()].filter(({ state }) => state === "accepted"),
    listCompleted: async () => [...values.values()].filter(({ state }) => state !== "accepted"),
    prune: async () => 0,
    close() {},
  };
}

async function harness(t: TestContext) {
  let revision = "authorization-1";
  let revoked = false;
  let cancelCount = 0;
  let ids = 0;
  let changeRevisionDuringHistory = false;
  const output: Array<{
    readonly deviceId: string;
    readonly contentType: RemoteSealedContentType;
    readonly value: object;
  }> = [];
  const session: RemoteSessionSummaryV1 = {
    sessionId: "session-1",
    workspace: { workspaceId: "workspace-1", displayName: "Project" },
    title: "Direct session",
    updatedAt: now.toISOString(),
    pinned: true,
    archived: false,
    attention: "none",
    runState: "running",
    entityRevision: "session-revision-1",
  };
  const currentAuthorization = () => ({
    deviceId: "device-1",
    allowedActions: ALL_ACTIONS,
    state: revoked ? ("revoked" as const) : ("active" as const),
    revision,
  });
  const authorizations = {
    get: (deviceId: string) => (deviceId === "device-1" ? currentAuthorization() : undefined),
    list: () => [currentAuthorization()],
    authorize: ({
      deviceId,
      action,
    }: {
      readonly deviceId: string;
      readonly action: RemoteAction;
    }) => {
      const authorization = deviceId === "device-1" ? currentAuthorization() : undefined;
      if (!authorization)
        throw Object.assign(new Error("device_not_paired"), { code: "device_not_paired" });
      if (authorization.state === "revoked")
        throw Object.assign(new Error("device_revoked"), { code: "device_revoked" });
      if (!authorization.allowedActions.includes(action))
        throw Object.assign(new Error("scope_denied"), { code: "scope_denied" });
      return authorization;
    },
  };
  const ledger = createRemoteOperationLedger({
    machineId: "machine-1",
    clock: { now: () => now },
    store: memoryLedgerStore(),
  });
  t.after(() => ledger.close());
  const commands = createRemoteCommandAdapter({
    runtime: {
      history: async () => {
        if (changeRevisionDuringHistory) revision = "authorization-2";
        return {
          events: [
            {
              event: {
                seq: 8,
                entryId: "message-1",
                time: now.getTime(),
                data: { message: { role: "assistant", content: "Safe answer", stopReason: "end" } },
              },
            },
          ],
          hasMore: false,
        };
      },
      prompt: async (input) => ({
        accepted: true,
        queued: false,
        messageId: input.clientMutation.messageId,
      }),
      cancel: async () => {
        cancelCount += 1;
        return { accepted: true };
      },
      answerQuestion: async () => ({ accepted: true }),
      getSessionState: async () => ({
        sessionId: session.sessionId,
        title: session.title,
        pinned: session.pinned,
        archived: session.archived,
        entityRevision: session.entityRevision,
      }),
    },
  });
  const processor = createDesktopRemoteFrameProcessor({
    machineId: "machine-1",
    epoch: "runtime-generation-1",
    clock: { now: () => now },
    id: () => `id-${++ids}`,
    authorizations,
    ledger,
    commands,
    readSessionCatalog: async () => [session],
    sendPlaintext: async (deviceId, contentType, value) =>
      void output.push({ deviceId, contentType, value }),
  });
  await processor.initialize();
  return {
    processor,
    output,
    cancelled: () => cancelCount,
    revoke: () => void (revoked = true),
    changeRevisionDuringHistory: () => void (changeRevisionDuringHistory = true),
  };
}

function control(
  requestId: string,
  query: RemoteControlRequestV1["query"],
): RemoteControlRequestV1 {
  return {
    type: "control.request",
    requestId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    query,
  };
}

test("executes a direct device operation at most once and emits accepted plus terminal results", async (t) => {
  const value = await harness(t);
  const request: RemoteOperationRequestV1 = {
    type: "operation.request",
    operationId: "operation-1",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    command: { type: "session.stop", sessionId: "session-1" },
  };
  await value.processor.receivePlaintext("device-1", request);
  assert.equal(value.cancelled(), 1);
  assert.deepEqual(
    value.output
      .map(({ value: item }) => parseRemoteOperationResultV1(item)?.state)
      .filter(Boolean),
    ["accepted", "succeeded"],
  );
  await value.processor.receivePlaintext("device-1", request);
  assert.equal(value.cancelled(), 1);
  assert.equal(parseRemoteOperationResultV1(value.output.at(-1)?.value)?.state, "succeeded");
});

test("serves catalog, history, status, and snapshot recovery only through closed projections", async (t) => {
  const value = await harness(t);
  await value.processor.receivePlaintext(
    "device-1",
    control("catalog", { type: "session.catalog.read" }),
  );
  await value.processor.receivePlaintext(
    "device-1",
    control("history", { type: "conversation.history.read", sessionId: "session-1" }),
  );
  await value.processor.receivePlaintext(
    "device-1",
    control("status", { type: "operations.status", operationIds: ["missing-operation"] }),
  );
  await value.processor.receivePlaintext(
    "device-1",
    control("recovery", { type: "sync.recover", unresolvedOperationIds: [] }),
  );
  const responses = value.output
    .map(({ value: item }) => parseRemoteControlResponseV1(item))
    .filter(Boolean);
  assert.equal(responses.length, 4);
  assert.ok(value.output.some(({ value: item }) => parseRemoteSnapshotChunkV1(item)));
  assert.ok(value.output.some(({ value: item }) => parseRemoteSnapshotCompleteV1(item)));
  assert.equal(JSON.stringify(value.output).includes("tool"), false);
});

test("rechecks revocation and authorization revision around local Runtime reads", async (t) => {
  const revoked = await harness(t);
  revoked.revoke();
  await assert.rejects(
    () =>
      revoked.processor.receivePlaintext(
        "device-1",
        control("catalog", { type: "session.catalog.read" }),
      ),
    /device_revoked/u,
  );

  const changed = await harness(t);
  changed.changeRevisionDuringHistory();
  await changed.processor.receivePlaintext(
    "device-1",
    control("history", { type: "conversation.history.read", sessionId: "session-1" }),
  );
  const response = parseRemoteControlResponseV1(changed.output.at(-1)?.value);
  assert.ok(response && "error" in response);
  assert.equal(response.error.code, "authorization_revision_changed");
});
