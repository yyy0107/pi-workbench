import assert from "node:assert/strict";
import test from "node:test";

const { createServerRequest, createSessionEventPayload, STREAM_PATHS } = (await import(
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

  assert.deepEqual(createSessionEventPayload("session-1", event), {
    type: "session/event",
    sessionId: "session-1",
    event,
  });
});
