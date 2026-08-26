import assert from "node:assert/strict";
import test from "node:test";

const {
  createServerRequest,
  createSessionEventPayload,
  createSessionMessageSnapshotPayload,
  createSessionMessageUpdatePayload,
  isSessionMessageDelta,
  STREAM_PATHS,
} = (await import(
  new URL("./stream-contracts.ts", import.meta.url).href
)) as typeof import("./stream-contracts");

test("creates the exact ServerRequest envelope with method equal to payload.type", () => {
  const payload = {
    type: "host/session-status" as const,
    sessionId: "session-1",
    running: true,
  };

  assert.deepEqual(createServerRequest("rpc-1", payload), {
    type: "server-request",
    rpcId: "rpc-1",
    method: "host/session-status",
    payload,
  });
  assert.deepEqual(STREAM_PATHS, {
    mux: "/api/events.mux",
    host: "/api/events.host",
  });
});

test("wraps canonical session events without changing their sequence data", () => {
  const event = {
    type: "message-created",
    seq: 42,
    time: 1_725_000_000_000,
    data: { messageId: "message-1" },
  };

  assert.deepEqual(
    createSessionEventPayload("session-1", event, {
      startedAt: 1_724_999_999_000,
      elapsedMs: 1_000,
    }),
    {
      type: "session/event",
      sessionId: "session-1",
      event,
      runTiming: { startedAt: 1_724_999_999_000, elapsedMs: 1_000 },
    },
  );
});

test("wraps compact message updates without cumulative content or a durable sequence", () => {
  assert.deepEqual(
    createSessionMessageUpdatePayload(
      "session-1",
      "stream-1",
      7,
      42,
      1_725_000_000_001,
      { role: "assistant", model: "model-1" },
      { type: "text_delta", contentIndex: 0, delta: "Hello" },
    ),
    {
      type: "session/message-update",
      format: "pi-messages-v1",
      sessionId: "session-1",
      streamId: "stream-1",
      revision: 7,
      startSeq: 42,
      time: 1_725_000_000_001,
      message: { role: "assistant", model: "model-1" },
      update: { type: "text_delta", contentIndex: 0, delta: "Hello" },
    },
  );
});

test("creates reconnect snapshots with raw partial tool argument buffers", () => {
  assert.deepEqual(
    createSessionMessageSnapshotPayload(
      "session-1",
      "stream-1",
      3,
      42,
      1_725_000_000_002,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "search", arguments: { query: "hel" } }],
      },
      { "0": '{"query":"hel' },
    ),
    {
      type: "session/message-snapshot",
      format: "pi-messages-v1",
      sessionId: "session-1",
      streamId: "stream-1",
      revision: 3,
      startSeq: 42,
      time: 1_725_000_000_002,
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "search", arguments: { query: "hel" } }],
      },
      toolCallJson: { "0": '{"query":"hel' },
    },
  );
});

test("accepts only non-terminal pi-messages content events", () => {
  assert.equal(isSessionMessageDelta({ type: "text_delta", contentIndex: 0, delta: "x" }), true);
  assert.equal(
    isSessionMessageDelta({
      type: "thinking_end",
      contentIndex: 1,
      content: "reason",
      contentSignature: "",
      redacted: true,
    }),
    true,
  );
  assert.equal(isSessionMessageDelta({ type: "done", usage: {}, reason: "stop" }), false);
  assert.equal(isSessionMessageDelta({ type: "text_delta", contentIndex: -1, delta: "x" }), false);
});

test("allows a pre-token revision-zero snapshot but not a revision-zero delta", () => {
  assert.doesNotThrow(() =>
    createSessionMessageSnapshotPayload("session-1", "stream-1", 0, 4, 1, {
      role: "assistant",
      content: [],
    }),
  );
  assert.throws(
    () =>
      createSessionMessageUpdatePayload(
        "session-1",
        "stream-1",
        0,
        4,
        1,
        { role: "assistant" },
        { type: "text_start", contentIndex: 0 },
      ),
    /positive integer/,
  );
});
