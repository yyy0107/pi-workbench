import assert from "node:assert/strict";
import test from "node:test";

import type {
  RemoteConversationPageV1,
  RemoteOperationResultV1,
} from "@workbench/remote-control-contracts/protocol";

import { createRemoteConversationState } from "../src/conversation.ts";

const firstPage: RemoteConversationPageV1 = {
  sessionId: "session-1",
  items: [
    {
      type: "assistant-message",
      itemId: "message-2",
      createdAt: "2030-09-13T20:00:02.000Z",
      text: "Second",
      state: "complete",
    },
  ],
  historyCursor: "history-newest",
  nextCursor: "history-older",
  sessionRevision: "session-revision-2",
  projectionCursor: { epoch: "epoch-1", offset: "2" },
};

test("merges bounded history pages and streaming deltas without duplicating items", () => {
  const state = createRemoteConversationState({ machineId: "machine-1", sessionId: "session-1" });
  state.applyHistoryPage(firstPage);
  const { nextCursor: _nextCursor, ...olderPageBase } = firstPage;
  state.applyHistoryPage({
    ...olderPageBase,
    items: [
      {
        type: "user-message",
        itemId: "message-1",
        createdAt: "2030-09-13T20:00:01.000Z",
        text: "First",
        state: "complete",
      },
    ],
    historyCursor: "history-older",
    projectionCursor: { epoch: "epoch-1", offset: "1" },
  });
  state.applyMessageDelta({
    sessionId: "session-1",
    streamId: "stream-1",
    revision: "stream-revision-1",
    delta: "Hel",
  });
  state.applyMessageDelta({
    sessionId: "session-1",
    streamId: "stream-1",
    revision: "stream-revision-2",
    delta: "lo",
  });
  state.applyMessageDelta({
    sessionId: "session-1",
    streamId: "stream-1",
    revision: "stream-revision-2",
    delta: "must-not-duplicate",
  });

  const snapshot = state.snapshot();
  assert.deepEqual(
    snapshot.items.map((item) => ("itemId" in item ? item.itemId : item.interactionId)),
    ["message-1", "message-2", "stream-1"],
  );
  const streamed = snapshot.items.find((item) => "itemId" in item && item.itemId === "stream-1");
  assert.equal(streamed?.type === "assistant-message" ? streamed.text : undefined, "Hello");
  assert.equal(snapshot.nextHistoryCursor, undefined);
});

test("preserves tool calls while bounding a long streaming assistant message", () => {
  const state = createRemoteConversationState({ machineId: "machine-1", sessionId: "session-1" });
  state.applyHistoryPage({
    ...firstPage,
    items: [
      {
        type: "assistant-message",
        itemId: "stream-with-tool",
        createdAt: "2030-09-13T20:00:02.000Z",
        toolCalls: [
          {
            toolCallId: "tool-1",
            toolName: "exec",
            arguments: '{"command":"pnpm test"}',
            truncated: false,
          },
        ],
        state: "streaming",
      },
    ],
  });
  for (let index = 0; index < 8; index += 1) {
    state.applyMessageDelta({
      sessionId: "session-1",
      streamId: "stream-with-tool",
      revision: `stream-revision-${index}`,
      delta: "界".repeat(5_000),
    });
  }

  const item = state.snapshot().items[0];
  assert.equal(item?.type, "assistant-message");
  if (item?.type === "assistant-message") {
    assert.equal(item.toolCalls?.[0]?.arguments, '{"command":"pnpm test"}');
    assert.equal(item.textTruncated, true);
    assert.ok(Buffer.byteLength(item.text ?? "", "utf8") <= 96 * 1024);
    assert.equal(item.text?.includes("�"), false);
  }
});

test("keeps terminal operations pending until their applied cursor is visible", () => {
  const state = createRemoteConversationState({ machineId: "machine-1", sessionId: "session-1" });
  state.applyHistoryPage(firstPage);
  state.setReady(true);
  state.setDraft("Send this once");
  const prepared = state.prepareTextSend({
    operationId: "operation-1",
    issuedAt: "2030-09-13T20:00:03.000Z",
    expiresAt: "2030-09-13T20:01:03.000Z",
  });
  assert.equal(prepared.kind, "operation");
  assert.equal(state.snapshot().operations[0]?.status, "sending");

  const accepted: RemoteOperationResultV1 = {
    type: "operation.result",
    operationId: "operation-1",
    state: "accepted",
  };
  state.applyOperationResult(accepted);
  assert.equal(state.snapshot().operations[0]?.status, "accepted");
  assert.equal(state.snapshot().draft, "");

  state.applyOperationResult({
    type: "operation.result",
    operationId: "operation-1",
    state: "succeeded",
    value: { type: "message-accepted", sessionId: "session-1", messageId: "message-3" },
    appliedCursor: { epoch: "epoch-1", offset: "5" },
  });
  assert.equal(state.snapshot().operations[0]?.status, "awaiting-projection");
  state.advanceProjectionCursor({ epoch: "epoch-1", offset: "4" });
  assert.equal(state.snapshot().operations.length, 1);
  state.advanceProjectionCursor({ epoch: "epoch-1", offset: "5" });
  assert.equal(state.snapshot().operations.length, 0);
});

test("marks an in-flight result outcome unknown and never auto-sends an offline draft", () => {
  const state = createRemoteConversationState({ machineId: "machine-1", sessionId: "session-1" });
  state.setDraft("Keep locally");
  const offline = state.prepareTextSend({
    operationId: "offline-operation",
    issuedAt: "2030-09-13T20:00:03.000Z",
    expiresAt: "2030-09-13T20:01:03.000Z",
  });
  assert.deepEqual(offline, { kind: "draft-only", reason: "offline" });
  assert.equal(state.snapshot().operations.length, 0);

  state.setReady(true);
  assert.equal(state.snapshot().draft, "Keep locally");
  assert.equal(state.snapshot().operations.length, 0);
  state.prepareTextSend({
    operationId: "explicit-operation",
    issuedAt: "2030-09-13T20:00:04.000Z",
    expiresAt: "2030-09-13T20:01:04.000Z",
  });
  state.markDisconnected();
  assert.equal(state.snapshot().operations[0]?.status, "outcome-unknown");
  assert.equal(state.snapshot().operations[0]?.operationId, "explicit-operation");
});
