import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import type {
  RemoteConversationItemV1,
  RemoteEventV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import { mergeRemoteConversationItems } from "../lib/bounded-pages.ts";
import { createRemoteSessionManagementState } from "../src/session-management.ts";
import { createRemoteSynchronizationState } from "../src/synchronization.ts";

function session(index: number): RemoteSessionSummaryV1 {
  return {
    sessionId: `session-${index}`,
    title: `会话 ${index} 🚀 ${"界".repeat(8)}`,
    updatedAt: new Date(Date.UTC(2026, 8, 13, 20, 0, index % 60)).toISOString(),
    pinned: index % 17 === 0,
    archived: false,
    attention: index % 13 === 0 ? "unread" : "none",
    runState: index % 7 === 0 ? "running" : "idle",
    entityRevision: `revision-${index}`,
  };
}

test("profiles 200 sessions, 10,000 contiguous events, and bounded multibyte history", async (context) => {
  const startedAt = performance.now();
  const management = createRemoteSessionManagementState({ machineId: "machine-profile" });
  const sessions = Array.from({ length: 200 }, (_, index) => session(index));
  management.replaceCatalog(sessions);
  for (const item of sessions) management.setDraft(item.sessionId, `草稿 🚀 ${item.sessionId}`);

  let applied = 0;
  const synchronization = createRemoteSynchronizationState({
    initialCursor: { epoch: "profile-epoch", offset: "0" },
    projection: {
      applyEvent: async () => void (applied += 1),
      replaceSnapshot: async () => {},
    },
  });
  for (let index = 1; index <= 10_000; index += 1) {
    const event: RemoteEventV1 = {
      type: "sync.event",
      eventId: `event-${index}`,
      cursor: { epoch: "profile-epoch", offset: String(index) },
      createdAt: "2026-09-13T20:00:00.000Z",
      payload: {
        type: "session.runChanged",
        sessionId: `session-${index % 200}`,
        runState: index % 2 === 0 ? "running" : "idle",
      },
    };
    const result = await synchronization.receiveEvent(event);
    assert.equal(result.kind, "applied");
  }

  let history: readonly RemoteConversationItemV1[] = [];
  for (let page = 0; page < 10; page += 1) {
    const items: RemoteConversationItemV1[] = Array.from({ length: 100 }, (_, index) => ({
      type: "assistant-message",
      itemId: `message-${page * 100 + index}`,
      createdAt: new Date(Date.UTC(2026, 8, 13, 20, page, index % 60)).toISOString(),
      text: `回答 ${"界".repeat(24)} 🚀 ${page}-${index}`,
      state: "complete",
    }));
    history = mergeRemoteConversationItems({ current: history, page: items, direction: "append" });
  }

  const elapsedMs = performance.now() - startedAt;
  const retainedBytes = new TextEncoder().encode(
    JSON.stringify({ management: management.snapshot(), history }),
  ).byteLength;
  assert.equal(applied, 10_000);
  assert.deepEqual(synchronization.snapshot().cursor, {
    epoch: "profile-epoch",
    offset: "10000",
  });
  assert.equal(management.snapshot().items.length, 200);
  assert.equal(Object.keys(management.snapshot().localBySession).length, 200);
  assert.equal(history.length, 200);
  assert.equal(retainedBytes < 512 * 1024, true);
  assert.equal(elapsedMs < 10_000, true);
  context.diagnostic(
    `reference profile: ${elapsedMs.toFixed(1)} ms, ${retainedBytes} retained UTF-8 bytes`,
  );
});
