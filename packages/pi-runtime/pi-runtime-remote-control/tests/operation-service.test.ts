import assert from "node:assert/strict";
import test from "node:test";

import type {
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
} from "@workbench/remote-control-contracts/protocol";

import {
  createRemoteCommandAdapter,
  type RemoteCommandRuntimePort,
} from "../src/command-adapter.ts";
import {
  createRemoteOperationLedger,
  type RemoteOperationLedgerRecord,
  type RemoteOperationLedgerStorePort,
} from "../src/operation-ledger.ts";
import { createRemoteOperationService } from "../src/operation-service.ts";

const authority = {
  machineId: "machine-1",
  deviceId: "device-1",
  authorizationRevision: "authorization-1",
} as const;

function request(
  operationId: string,
  command: RemoteOperationRequestV1["command"],
  expiresAt = "2026-09-13T20:05:00.000Z",
): RemoteOperationRequestV1 {
  return {
    type: "operation.request",
    operationId,
    issuedAt: "2026-09-13T20:00:00.000Z",
    expiresAt,
    command,
  };
}

function createMemoryStore(): RemoteOperationLedgerStorePort {
  const records = new Map<string, RemoteOperationLedgerRecord>();
  const key = (value: { deviceId: string; operationId: string }) =>
    `${value.deviceId}:${value.operationId}`;
  return {
    get: async (input) => records.get(key(input)),
    insertAccepted: async (record) => {
      const id = key(record);
      if (records.has(id)) return false;
      records.set(id, record);
      return true;
    },
    finish: async (input) => {
      const id = key(input);
      const record = records.get(id);
      if (!record) return undefined;
      const finished = {
        ...record,
        state: input.result.state,
        result: input.result,
        finishedAt: input.finishedAt,
      };
      records.set(id, finished);
      return finished;
    },
    listIncomplete: async (machineId) =>
      [...records.values()].filter(
        (record) => record.machineId === machineId && record.state === "accepted",
      ),
    listCompleted: async (machineId) =>
      [...records.values()].filter(
        (record) => record.machineId === machineId && record.state !== "accepted",
      ),
    prune: async () => 0,
    close: () => {},
  };
}

function harness() {
  let now = new Date("2026-09-13T20:01:00.000Z");
  let promptEffects = 0;
  let cancelEffects = 0;
  let managementEffects = 0;
  let authorizationCalls = 0;
  let revokeAfterFirstAuthorization = false;
  let currentAuthorizationRevision = "authorization-1";
  let pendingInteraction = {
    interactionId: "interaction-1",
    sessionId: "session-1",
    revision: "interaction-revision-1",
    expiresAt: "2026-09-13T20:04:00.000Z",
  };
  const published: RemoteOperationResultV1[] = [];
  const managedSessions = new Map<
    string,
    {
      sessionId: string;
      title: string;
      pinned: boolean;
      archived: boolean;
      entityRevision: string;
    }
  >([
    [
      "session-managed",
      {
        sessionId: "session-managed",
        title: "Original",
        pinned: false,
        archived: false,
        entityRevision: "revision-1",
      },
    ],
  ]);
  let managementRevision = 1;
  const updateManaged = (
    sessionId: string,
    patch: Partial<{ title: string; pinned: boolean; archived: boolean }>,
  ) => {
    const current = managedSessions.get(sessionId);
    if (!current)
      throw Object.assign(new Error("operation_not_found"), { code: "operation_not_found" });
    managementEffects += 1;
    managementRevision += 1;
    const next = {
      ...current,
      ...patch,
      entityRevision: `revision-${managementRevision}`,
    };
    managedSessions.set(sessionId, next);
    return next;
  };
  const runtime: RemoteCommandRuntimePort = {
    history: async () => ({ events: [], hasMore: false }),
    prompt: async (input) => {
      promptEffects += 1;
      return { accepted: true, queued: false, messageId: input.clientMutation.messageId };
    },
    cancel: async () => {
      cancelEffects += 1;
      return { accepted: true };
    },
    answerQuestion: async () => ({ accepted: true }),
    listWorkspaces: async () => [{ workspaceId: "workspace-1", displayName: "Workspace" }],
    getSessionState: async (sessionId) => managedSessions.get(sessionId),
    createSession: async ({ requestedSessionId }) => {
      managementEffects += 1;
      managedSessions.set(requestedSessionId, {
        sessionId: requestedSessionId,
        title: "New session",
        pinned: false,
        archived: false,
        entityRevision: "revision-created",
      });
      return { sessionId: requestedSessionId };
    },
    renameSession: async ({ sessionId, title }) => updateManaged(sessionId, { title }),
    setSessionPinned: async ({ sessionId, pinned }) => updateManaged(sessionId, { pinned }),
    archiveSession: async ({ sessionId }) => updateManaged(sessionId, { archived: true }),
  };
  const ledger = createRemoteOperationLedger({
    machineId: "machine-1",
    clock: { now: () => now },
    store: createMemoryStore(),
  });
  const service = createRemoteOperationService({
    clock: { now: () => now },
    ledger,
    authorization: {
      authorize: ({ authority: candidate }) => {
        authorizationCalls += 1;
        if (candidate.machineId !== "machine-1" || candidate.deviceId !== "device-1") {
          throw Object.assign(new Error("scope_denied"), { code: "scope_denied" });
        }
        if (candidate.authorizationRevision !== currentAuthorizationRevision) {
          throw Object.assign(new Error("device_revoked"), { code: "device_revoked" });
        }
        if (revokeAfterFirstAuthorization && authorizationCalls === 1) {
          currentAuthorizationRevision = "authorization-2";
        }
      },
    },
    interactions: { get: () => pendingInteraction },
    commands: createRemoteCommandAdapter({ runtime }),
    publisher: {
      publish: ({ result }) => {
        published.push(structuredClone(result));
      },
    },
    currentCursor: () => ({ epoch: "epoch-1", offset: "8" }),
  });
  return {
    service,
    ledger,
    published,
    runtime,
    get promptEffects() {
      return promptEffects;
    },
    get cancelEffects() {
      return cancelEffects;
    },
    get managementEffects() {
      return managementEffects;
    },
    set now(value: Date) {
      now = value;
    },
    revoke() {
      currentAuthorizationRevision = "authorization-2";
    },
    revokeBeforeEffect() {
      authorizationCalls = 0;
      revokeAfterFirstAuthorization = true;
    },
    setPending(value: typeof pendingInteraction) {
      pendingInteraction = value;
    },
  };
}

test("publishes accepted then terminal, persists the result, and replays without another prompt", async () => {
  const testHarness = harness();
  const operation = request("operation-1", {
    type: "session.send",
    sessionId: "session-1",
    text: "Secret prompt body",
  });

  const first = await testHarness.service.execute({ authority, request: operation });
  assert.deepEqual(
    testHarness.published.map(({ state }) => state),
    ["accepted", "succeeded"],
  );
  assert.deepEqual(first, {
    type: "operation.result",
    operationId: "operation-1",
    state: "succeeded",
    value: {
      type: "message-accepted",
      sessionId: "session-1",
      messageId: "operation-1",
    },
    appliedCursor: { epoch: "epoch-1", offset: "8" },
  });
  assert.equal(testHarness.promptEffects, 1);
  assert.equal(JSON.stringify(testHarness.published).includes("Secret prompt body"), false);

  testHarness.published.length = 0;
  assert.deepEqual(await testHarness.service.execute({ authority, request: operation }), first);
  assert.deepEqual(testHarness.published, [first]);
  assert.equal(testHarness.promptEffects, 1);

  const conflict = await testHarness.service.execute({
    authority,
    request: request("operation-1", {
      type: "session.send",
      sessionId: "session-1",
      text: "Different body",
    }),
  });
  assert.deepEqual(conflict, {
    type: "operation.result",
    operationId: "operation-1",
    state: "rejected",
    code: "operation_id_conflict",
  });
  assert.equal(testHarness.promptEffects, 1);
});

test("rejects expired operations, stale interactions, and a revocation racing the effect", async () => {
  const testHarness = harness();
  assert.deepEqual(
    await testHarness.service.execute({
      authority,
      request: request(
        "operation-expired",
        { type: "session.stop", sessionId: "session-1" },
        "2026-09-13T20:00:30.000Z",
      ),
    }),
    {
      type: "operation.result",
      operationId: "operation-expired",
      state: "expired",
      code: "operation_expired",
    },
  );

  assert.deepEqual(
    await testHarness.service.execute({
      authority,
      request: request("operation-question", {
        type: "interaction.answerQuestion",
        sessionId: "session-1",
        interactionId: "interaction-1",
        interactionRevision: "stale-revision",
        answers: [{ questionId: "target", optionIds: ["Code"] }],
      }),
    }),
    {
      type: "operation.result",
      operationId: "operation-question",
      state: "rejected",
      code: "interaction_not_pending",
    },
  );

  testHarness.revokeBeforeEffect();
  assert.deepEqual(
    await testHarness.service.execute({
      authority,
      request: request("operation-revoked", { type: "session.stop", sessionId: "session-1" }),
    }),
    {
      type: "operation.result",
      operationId: "operation-revoked",
      state: "rejected",
      code: "device_revoked",
    },
  );
  assert.equal(testHarness.cancelEffects, 0);
});

test("fixes create identity and reconciles set-to-value mutations with revision conflicts", async () => {
  const testHarness = harness();
  const createRequest = request("session-created-fixed", {
    type: "session.create",
    workspaceId: "workspace-1",
    title: "Created title",
  });
  const created = await testHarness.service.execute({ authority, request: createRequest });
  assert.deepEqual(created, {
    type: "operation.result",
    operationId: "session-created-fixed",
    state: "succeeded",
    value: { type: "session-created", sessionId: "session-created-fixed" },
    appliedCursor: { epoch: "epoch-1", offset: "8" },
  });
  assert.equal(testHarness.managementEffects, 2);
  assert.equal(
    (
      await testHarness.ledger.get({
        deviceId: "device-1",
        operationId: "session-created-fixed",
      })
    )?.domainIdentity?.type,
    "session",
  );
  assert.deepEqual(
    await testHarness.service.execute({ authority, request: createRequest }),
    created,
  );
  assert.equal(testHarness.managementEffects, 2);

  const alreadyAuthoritative = await testHarness.service.execute({
    authority,
    request: request("pin-already-false", {
      type: "session.setPinned",
      sessionId: "session-managed",
      pinned: false,
      expectedEntityRevision: "stale-but-no-change",
    }),
  });
  assert.deepEqual(alreadyAuthoritative, {
    type: "operation.result",
    operationId: "pin-already-false",
    state: "succeeded",
    value: {
      type: "session-state",
      sessionId: "session-managed",
      entityRevision: "revision-1",
    },
    appliedCursor: { epoch: "epoch-1", offset: "8" },
  });
  assert.equal(testHarness.managementEffects, 2);

  assert.deepEqual(
    await testHarness.service.execute({
      authority,
      request: request("rename-conflict", {
        type: "session.rename",
        sessionId: "session-managed",
        title: "Conflicting title",
        expectedEntityRevision: "stale-revision",
      }),
    }),
    {
      type: "operation.result",
      operationId: "rename-conflict",
      state: "rejected",
      code: "entity_revision_conflict",
    },
  );
  assert.equal(testHarness.managementEffects, 2);

  assert.deepEqual(
    await testHarness.service.execute({
      authority,
      request: request("rename-success", {
        type: "session.rename",
        sessionId: "session-managed",
        title: "Authoritative title",
        expectedEntityRevision: "revision-1",
      }),
    }),
    {
      type: "operation.result",
      operationId: "rename-success",
      state: "succeeded",
      value: {
        type: "session-state",
        sessionId: "session-managed",
        entityRevision: "revision-3",
      },
      appliedCursor: { epoch: "epoch-1", offset: "8" },
    },
  );
  assert.equal(testHarness.managementEffects, 3);
});
