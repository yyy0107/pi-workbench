import assert from "node:assert/strict";
import test from "node:test";

import type {
  RemoteConversationPageV1,
  RemoteEventV1,
  RemoteOperationRequestV1,
} from "@workbench/remote-control-contracts/protocol";

import type { MobilePersistedOperation } from "../src/platform/sqlite.ts";
import {
  createMobileConversationStore,
  type MobileConversationCachePort,
} from "../src/state/conversation-store.ts";
import { createMobileRemoteSession } from "../src/state/remote-session.ts";

function page(offset: string): RemoteConversationPageV1 {
  return {
    sessionId: "session-1",
    items: [],
    historyCursor: "tail",
    sessionRevision: `revision-${offset}`,
    projectionCursor: { epoch: "epoch-1", offset },
  };
}

function memoryCache(initialPage?: RemoteConversationPageV1): MobileConversationCachePort {
  let cachedPage = initialPage;
  let draft = "";
  const operations = new Map<string, MobilePersistedOperation>();
  return {
    load: async () => cachedPage,
    save: async (_machineId, value) => void (cachedPage = structuredClone(value)),
    loadDraft: async () => draft,
    saveDraft: async (_machineId, _sessionId, value) => void (draft = value),
    listOperations: async () => [...operations.values()],
    saveOperation: async (value) => void operations.set(value.operationId, structuredClone(value)),
    removeOperation: async (_machineId, operationId) => void operations.delete(operationId),
  };
}

test("replaces a cached duplicate lifecycle projection with the authoritative latest page", async () => {
  const message = {
    type: "user-message" as const,
    createdAt: "2030-09-13T20:00:01.000Z",
    text: "Hello",
    state: "complete" as const,
  };
  const cached = {
    ...page("1"),
    items: [
      { ...message, itemId: "message-start" },
      { ...message, itemId: "message-end" },
    ],
  };
  const session = createMobileRemoteSession({
    machineId: "machine-1",
    sessionId: "session-1",
    store: createMobileConversationStore({
      cache: memoryCache(cached),
      clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
    }),
    remote: {
      readHistory: async () => ({
        ...page("1"),
        items: [{ ...message, itemId: "message-end" }],
      }),
      submit: async () => undefined,
    },
    clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
    createOperationId: () => "operation-1",
  });

  await session.initialize(true);

  assert.deepEqual(
    session.snapshot().items.map((item) => ("itemId" in item ? item.itemId : item.interactionId)),
    ["message-end"],
  );
});

test("re-reads canonical desktop nodes instead of appending a simplified live lifecycle item", async () => {
  let listener: ((payload: RemoteEventV1) => void) | undefined;
  let reads = 0;
  const canonicalPage: RemoteConversationPageV1 = {
    ...page("2"),
    items: [
      {
        type: "conversation-node",
        itemId: "assistant-1",
        createdAt: "2030-09-13T20:00:01.000Z",
        kind: "assistant",
        status: "complete",
        blocks: [
          {
            kind: "tool-call",
            key: "tool-1",
            callId: "call-1",
            toolName: "read",
            argumentsText: '{"path":"README.md"}',
            status: "complete",
            result: "contents",
            truncated: false,
          },
        ],
      },
    ],
  };
  const session = createMobileRemoteSession({
    machineId: "machine-1",
    sessionId: "session-1",
    store: createMobileConversationStore({
      cache: memoryCache(),
      clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
    }),
    remote: {
      readHistory: async () => (++reads === 1 ? page("1") : canonicalPage),
      submit: async () => undefined,
      subscribe: (_machineId, next) => {
        listener = next as (payload: RemoteEventV1) => void;
        return () => void (listener = undefined);
      },
    },
    clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
    createOperationId: () => "operation-1",
  });

  await session.initialize(true);
  listener?.({
    type: "sync.event",
    eventId: "event-2",
    cursor: { epoch: "epoch-1", offset: "2" },
    createdAt: "2030-09-13T20:00:01.000Z",
    payload: {
      type: "session.messageAppended",
      sessionId: "session-1",
      item: {
        type: "assistant-message",
        itemId: "legacy-assistant-1",
        createdAt: "2030-09-13T20:00:01.000Z",
        text: "simplified",
        state: "complete",
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(reads, 2);
  assert.deepEqual(session.snapshot().items, canonicalPage.items);
  session.dispose();
});

test("coordinates accepted, terminal, applied cursor, disconnect, and explicit retry only", async () => {
  const submitted: RemoteOperationRequestV1[] = [];
  let nextId = 0;
  const store = createMobileConversationStore({
    cache: memoryCache(),
    clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
  });
  const session = createMobileRemoteSession({
    machineId: "machine-1",
    sessionId: "session-1",
    store,
    remote: {
      readHistory: async () => page("1"),
      submit: async ({ request }) => void submitted.push(structuredClone(request)),
      recoverOperations: async ({ operationIds }) =>
        operationIds.map((operationId) => ({
          type: "operation.result" as const,
          operationId,
          state: "rejected" as const,
          code: "operation_not_found" as const,
        })),
    },
    clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
    createOperationId: () => `operation-${++nextId}`,
  });

  await session.initialize(true);
  assert.equal(session.snapshot().ready, true);
  await session.setDraft("Send once");
  await session.sendText();
  assert.equal(submitted.length, 1);
  assert.equal(session.snapshot().draft, "Send once");

  await session.applyOperationResult({
    type: "operation.result",
    operationId: "operation-1",
    state: "accepted",
  });
  assert.equal(session.snapshot().draft, "");
  await session.applyOperationResult({
    type: "operation.result",
    operationId: "operation-1",
    state: "succeeded",
    value: { type: "message-accepted", sessionId: "session-1", messageId: "operation-1" },
    appliedCursor: { epoch: "epoch-1", offset: "3" },
  });
  assert.equal(session.snapshot().operations[0]?.status, "awaiting-projection");
  await session.advanceProjectionCursor({ epoch: "epoch-1", offset: "3" });
  assert.equal(session.snapshot().operations.length, 0);

  await session.setDraft("Retry explicitly");
  await session.sendText();
  assert.equal(submitted.length, 2);
  await session.markDisconnected();
  assert.equal(session.snapshot().operations[0]?.status, "outcome-unknown");
  session.markReady();
  assert.equal(submitted.length, 2, "reconnect must not resubmit automatically");
  await session.recoverOutcomes();
  assert.equal(session.snapshot().errorCode, "operation_not_found");
  await session.retry("operation-2");
  assert.equal(submitted.length, 3);
  assert.notEqual(submitted[1]?.operationId, submitted[2]?.operationId);
  assert.equal(submitted[2]?.command.type, "session.send");
});

test("queries a timed-out operation by the same ID and never auto-resends an expired request", async () => {
  const submitted: RemoteOperationRequestV1[] = [];
  const recovered: string[][] = [];
  let now = new Date("2026-09-13T20:00:00.000Z");
  let nextId = 0;
  const session = createMobileRemoteSession({
    machineId: "machine-1",
    sessionId: "session-1",
    store: createMobileConversationStore({ cache: memoryCache(), clock: { now: () => now } }),
    remote: {
      readHistory: async () => page("1"),
      submit: async ({ request }) => void submitted.push(structuredClone(request)),
      recoverOperations: async ({ operationIds }) => {
        recovered.push([...operationIds]);
        return [];
      },
    },
    clock: { now: () => now },
    createOperationId: () => `operation-${++nextId}`,
  });
  await session.initialize(true);
  await session.setDraft("Do not duplicate");
  await session.sendText();
  await session.markDisconnected();
  now = new Date("2026-09-13T20:03:00.000Z");
  session.markReady();
  await session.recoverOutcomes();
  assert.deepEqual(recovered, [["operation-1"]]);
  assert.equal(submitted.length, 1, "status recovery must not resend the expired request");
  await assert.rejects(() => session.retry("operation-1"), /operation_outcome_unknown/u);
  assert.equal(submitted.length, 1);
});

test("keeps authoritative state when a revision conflict rejects an operation", async () => {
  let nextId = 0;
  const store = createMobileConversationStore({
    cache: memoryCache(),
    clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
  });
  const session = createMobileRemoteSession({
    machineId: "machine-1",
    sessionId: "session-1",
    store,
    remote: {
      readHistory: async () => page("5"),
      submit: async () => {},
    },
    clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
    createOperationId: () => `operation-${++nextId}`,
  });
  await session.initialize(true);
  await session.stop();
  await session.applyOperationResult({
    type: "operation.result",
    operationId: "operation-1",
    state: "rejected",
    code: "entity_revision_conflict",
  });
  assert.equal(session.snapshot().operations.length, 0);
  assert.equal(session.snapshot().projectionCursor?.offset, "5");
  assert.equal(session.snapshot().errorCode, "entity_revision_conflict");
});
