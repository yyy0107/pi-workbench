import assert from "node:assert/strict";
import test from "node:test";

import type {
  RemoteConversationPageV1,
  RemoteOperationRequestV1,
  RemoteRunStateV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import type { MobilePersistedOperation } from "../src/platform/sqlite.ts";
import {
  createMobileConversationStore,
  type MobileConversationCachePort,
} from "../src/state/conversation-store.ts";
import {
  createMobileSessionStore,
  type MobileSessionStorePersistencePort,
} from "../src/state/session-store.ts";

function page(sessionId: string, offset = "1"): RemoteConversationPageV1 {
  return {
    sessionId,
    items: [
      {
        type: "assistant-message",
        itemId: `message-${offset}`,
        createdAt: "2026-09-13T20:00:00.000Z",
        text: "Safe projected answer",
        state: "complete",
      },
    ],
    historyCursor: `history-${offset}`,
    sessionRevision: `revision-${offset}`,
    projectionCursor: { epoch: "epoch-1", offset },
  };
}

function request(operationId: string): RemoteOperationRequestV1 {
  return {
    type: "operation.request",
    operationId,
    issuedAt: "2026-09-13T20:00:00.000Z",
    expiresAt: "2026-09-13T20:05:00.000Z",
    command: { type: "session.send", sessionId: "session-1", text: "draft to send" },
  };
}

function memoryCache() {
  const conversations = new Map<string, RemoteConversationPageV1>();
  const conversationOrder: string[] = [];
  const drafts = new Map<string, string>();
  const operations = new Map<string, MobilePersistedOperation>();
  const key = (machineId: string, sessionId: string) => `${machineId}:${sessionId}`;
  const cache: MobileConversationCachePort = {
    load: async (machineId, sessionId) => conversations.get(key(machineId, sessionId)),
    save: async (machineId, value) => {
      const cacheKey = key(machineId, value.sessionId);
      conversations.set(cacheKey, structuredClone(value));
      const previous = conversationOrder.indexOf(cacheKey);
      if (previous >= 0) conversationOrder.splice(previous, 1);
      conversationOrder.unshift(cacheKey);
      for (const evicted of conversationOrder.splice(20)) conversations.delete(evicted);
    },
    loadDraft: async (machineId, sessionId) => drafts.get(key(machineId, sessionId)) ?? "",
    saveDraft: async (machineId, sessionId, text) => {
      const draftKey = key(machineId, sessionId);
      if (text) drafts.set(draftKey, text);
      else drafts.delete(draftKey);
    },
    listOperations: async (machineId, sessionId) =>
      [...operations.values()].filter(
        (operation) => operation.machineId === machineId && operation.sessionId === sessionId,
      ),
    saveOperation: async (value) => void operations.set(value.operationId, structuredClone(value)),
    removeOperation: async (_machineId, operationId) => void operations.delete(operationId),
  };
  return { cache, conversations, drafts, operations };
}

test("round-trips a bounded conversation, pending operation, and draft with 20-session LRU", async () => {
  const memory = memoryCache();
  const store = createMobileConversationStore({
    cache: memory.cache,
    clock: { now: () => new Date("2026-09-13T20:01:00.000Z") },
  });

  for (let index = 0; index < 21; index += 1) {
    await store.savePage("machine-1", page(`session-${index}`, String(index)));
  }
  assert.equal(memory.conversations.size, 20);
  assert.equal(memory.conversations.has("machine-1:session-0"), false);

  await store.savePage("machine-1", page("session-1", "22"));
  await store.saveDraft("machine-1", "session-1", "unsent draft");
  await store.saveOperation({
    machineId: "machine-1",
    sessionId: "session-1",
    request: request("operation-1"),
    status: "outcome-unknown",
  });
  const restored = await store.load("machine-1", "session-1");
  assert.equal(restored.page?.projectionCursor.offset, "22");
  assert.equal(restored.draft, "unsent draft");
  assert.equal(restored.operations[0]?.operationId, "operation-1");
  assert.equal(restored.operations[0]?.status, "outcome-unknown");
});

test("round-trips bounded raw tool transcripts but rejects credential-bearing operations", async () => {
  const memory = memoryCache();
  const store = createMobileConversationStore({
    cache: memory.cache,
    clock: { now: () => new Date("2026-09-13T20:01:00.000Z") },
  });

  await store.savePage("machine-1", {
    ...page("session-1"),
    items: [
      {
        type: "assistant-message",
        itemId: "assistant-tool-1",
        createdAt: "2026-09-13T20:00:00.000Z",
        toolCalls: [
          {
            toolCallId: "tool-1",
            toolName: "read",
            arguments: '{"path":"/Users/alice/.ssh/id_ed25519"}',
            truncated: false,
          },
        ],
        state: "complete",
      },
      {
        type: "tool-result",
        itemId: "tool-result-1",
        createdAt: "2026-09-13T20:00:01.000Z",
        toolCallId: "tool-1",
        toolName: "read",
        output: "original tool output",
        isError: false,
        truncated: false,
      },
    ],
  });
  const restored = await store.load("machine-1", "session-1");
  const toolResult = restored.page?.items.find((item) => item.type === "tool-result");
  assert.equal(toolResult?.type, "tool-result");
  if (toolResult?.type === "tool-result") {
    assert.equal(toolResult.output, "original tool output");
  }
  assert.throws(
    () =>
      store.saveOperation({
        machineId: "machine-1",
        sessionId: "session-1",
        request: {
          ...request("operation-2"),
          credential: "bearer-secret",
          approval: { type: "tool-approval", outcome: "allow" },
        } as never,
        status: "sending",
      }),
    /pending_operation_cache_invalid/u,
  );
  assert.equal(memory.conversations.size, 1);
  assert.equal(memory.operations.size, 0);
});

test("round-trips 200 isolated session drafts/read markers and preserves them on snapshot", async () => {
  const catalogs = new Map<string, RemoteSessionSummaryV1[]>();
  const local = new Map<
    string,
    {
      machineId: string;
      sessionId: string;
      draft: string;
      readMarker?: string;
      unread: boolean;
      runState: RemoteRunStateV1;
      updatedAt: string;
    }
  >();
  let submitCalls = 0;
  const persistence: MobileSessionStorePersistencePort = {
    loadCatalog: async (machineId) => catalogs.get(machineId) ?? [],
    replaceCatalog: async (machineId, items) => {
      catalogs.set(machineId, structuredClone([...items]));
    },
    loadLocalStates: async (machineId) =>
      [...local.values()].filter((value) => value.machineId === machineId),
    saveLocalState: async (value) => {
      local.set(`${value.machineId}:${value.sessionId}`, structuredClone(value));
    },
    clearMachine: async (machineId) => {
      catalogs.delete(machineId);
      for (const key of local.keys()) if (key.startsWith(`${machineId}:`)) local.delete(key);
    },
  };
  const store = createMobileSessionStore({
    persistence,
    clock: { now: () => new Date("2026-09-13T20:03:00.000Z") },
  });
  const summaries: RemoteSessionSummaryV1[] = Array.from({ length: 200 }, (_, index) => ({
    sessionId: `session-${index.toString().padStart(3, "0")}`,
    title: `Session ${index}`,
    updatedAt: new Date(Date.UTC(2026, 8, 13, 20, 0, index % 60)).toISOString(),
    pinned: index === 3,
    archived: false,
    attention: index === 1 ? "unread" : "none",
    runState: index === 1 ? "running" : "idle",
    entityRevision: `revision-${index}`,
  }));
  await store.replaceCatalog("machine-1", summaries);
  await store.saveLocalState({
    machineId: "machine-1",
    sessionId: "session-001",
    draft: "本地草稿🙂",
    readMarker: "cursor-9",
    unread: false,
    runState: "running",
  });

  summaries[1] = { ...summaries[1]!, title: "Authoritative title", runState: "idle" };
  await store.replaceCatalog("machine-1", summaries);
  const restored = await store.load("machine-1");
  assert.equal(restored.items.length, 200);
  assert.equal(restored.items[0]?.sessionId, "session-003");
  assert.deepEqual(restored.localBySession["session-001"], {
    draft: "本地草稿🙂",
    readMarker: "cursor-9",
    unread: false,
    runState: "idle",
  });
  assert.equal(submitCalls, 0, "persistence restore must never auto-submit a mutation");

  await store.clearMachine("machine-1");
  assert.deepEqual(await store.load("machine-1"), { items: [], localBySession: {} });
  assert.equal(local.size, 0);
  void submitCalls;
});
