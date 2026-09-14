import assert from "node:assert/strict";
import test from "node:test";

import { parseRemoteControlRequestV1, parseRemoteControlResponseV1 } from "../src/codecs.ts";

const issuedAt = "2030-09-13T20:00:00.000Z";
const expiresAt = "2030-09-13T20:01:00.000Z";
const cursor = { epoch: "epoch-1", offset: "7" } as const;
const session = {
  sessionId: "session-1",
  title: "Remote session",
  updatedAt: issuedAt,
  pinned: false,
  archived: false,
  attention: "none",
  runState: "idle",
  entityRevision: "revision-1",
} as const;

function request(query: unknown) {
  return {
    type: "control.request",
    requestId: "request-1",
    issuedAt,
    expiresAt,
    query,
  };
}

function response(value: unknown) {
  return {
    type: "control.response",
    requestId: "request-1",
    value,
  };
}

test("accepts only the four closed read and recovery control requests", () => {
  assert.ok(parseRemoteControlRequestV1(request({ type: "session.catalog.read" })));
  assert.ok(
    parseRemoteControlRequestV1(
      request({
        type: "conversation.history.read",
        sessionId: "session-1",
        historyCursor: "history-20",
      }),
    ),
  );
  assert.ok(
    parseRemoteControlRequestV1(
      request({
        type: "sync.recover",
        cursor,
        unresolvedOperationIds: ["operation-1"],
      }),
    ),
  );
  assert.ok(
    parseRemoteControlRequestV1(
      request({ type: "operations.status", operationIds: ["operation-1"] }),
    ),
  );

  assert.equal(
    parseRemoteControlRequestV1(request({ type: "runtime.call", method: "tools.run" })),
    undefined,
  );
  assert.equal(
    parseRemoteControlRequestV1({
      ...request({ type: "session.catalog.read" }),
      payload: { path: "/secret" },
    }),
    undefined,
  );
  assert.equal(
    parseRemoteControlRequestV1(request({ type: "operations.status", operationIds: [] })),
    undefined,
  );
});

test("strictly parses bounded catalog, history, replay, snapshot, and status responses", () => {
  assert.ok(
    parseRemoteControlResponseV1(
      response({ type: "session.catalog", sessions: [session], projectionCursor: cursor }),
    ),
  );
  const page = {
    sessionId: "session-1",
    items: [],
    historyCursor: "history-20",
    sessionRevision: "revision-1",
    projectionCursor: cursor,
  } as const;
  assert.ok(parseRemoteControlResponseV1(response({ type: "conversation.history", page })));
  const event = {
    type: "sync.event",
    eventId: "event-1",
    cursor,
    createdAt: issuedAt,
    payload: { type: "session.upserted", session },
  } as const;
  assert.ok(
    parseRemoteControlResponseV1(
      response({ type: "sync.replay", events: [event], currentCursor: cursor }),
    ),
  );
  assert.ok(
    parseRemoteControlResponseV1(response({ type: "sync.snapshot", snapshotId: "snapshot-1" })),
  );
  assert.ok(
    parseRemoteControlResponseV1(
      response({
        type: "operations.status",
        results: [{ type: "operation.result", operationId: "operation-1", state: "accepted" }],
      }),
    ),
  );
  assert.ok(
    parseRemoteControlResponseV1({
      type: "control.response",
      requestId: "request-1",
      error: { type: "remote.error", version: 1, code: "cursor_expired" },
    }),
  );
});

test("rejects ambiguous, oversized, and unbounded control responses", () => {
  assert.equal(
    parseRemoteControlResponseV1({
      ...response({ type: "sync.snapshot", snapshotId: "snapshot-1" }),
      error: { type: "remote.error", version: 1, code: "internal" },
    }),
    undefined,
  );
  assert.equal(
    parseRemoteControlResponseV1(
      response({
        type: "session.catalog",
        sessions: Array.from({ length: 201 }, (_, index) => ({
          ...session,
          sessionId: `session-${index}`,
        })),
        projectionCursor: cursor,
      }),
    ),
    undefined,
  );
  assert.equal(
    parseRemoteControlResponseV1(response({ type: "terminal.output", value: "secret" })),
    undefined,
  );
});
