import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteSessionSummaryV1 } from "@workbench/remote-control-contracts/protocol";

import { createRemoteEventRing } from "../lib/event-ring.ts";
import { createRemoteProjection } from "../src/projection.ts";
import { createRemoteSnapshotService } from "../src/snapshot-service.ts";

function session(sessionId: string, revision = "revision-1"): RemoteSessionSummaryV1 {
  return {
    sessionId,
    title: `Session ${sessionId}`,
    updatedAt: "2026-09-13T20:00:00.000Z",
    pinned: false,
    archived: false,
    attention: "none",
    runState: "idle",
    entityRevision: revision,
  };
}

test("retains replay by 10,000 events, 10 MiB, and 15 minutes", () => {
  let now = new Date("2026-09-13T20:00:00.000Z");
  let ids = 0;
  const ring = createRemoteEventRing({
    epoch: "epoch-1",
    clock: { now: () => now },
    id: () => `event-${++ids}`,
  });
  for (let index = 0; index < 10_001; index += 1) {
    ring.append({ type: "session.removed", sessionId: `session-${index}` });
  }
  assert.equal(ring.snapshot().events.length, 10_000);
  assert.deepEqual(ring.replayAfter({ epoch: "epoch-1", offset: "0" }), {
    kind: "cursor-expired",
    currentCursor: { epoch: "epoch-1", offset: "10001" },
  });
  assert.equal(
    ring.replayAfter({ epoch: "epoch-1", offset: "10000" }).events?.[0]?.cursor.offset,
    "10001",
  );

  const byteRing = createRemoteEventRing({
    epoch: "epoch-bytes",
    clock: { now: () => now },
    id: () => `multibyte-${++ids}`,
  });
  const delta = "界".repeat(5_000);
  for (let index = 0; index < 720; index += 1) {
    byteRing.append({
      type: "session.messageDelta",
      sessionId: "session-1",
      streamId: "stream-1",
      revision: `revision-${index}`,
      delta,
    });
  }
  assert.equal(byteRing.snapshot().retainedBytes <= 10 * 1024 * 1024, true);
  assert.equal(byteRing.snapshot().events.length < 720, true);

  const timeCursor = ring.currentCursor();
  now = new Date("2026-09-13T20:16:00.000Z");
  ring.append({ type: "session.removed", sessionId: "session-new" });
  assert.deepEqual(ring.replayAfter(timeCursor), {
    kind: "events",
    events: [ring.snapshot().events[0]],
    currentCursor: ring.currentCursor(),
  });
  assert.equal(ring.snapshot().events.length, 1);
});

test("classifies epoch, future gap, and exact replay without numeric precision loss", () => {
  const ring = createRemoteEventRing({
    epoch: "runtime-generation-2",
    initialOffset: "18446744073709551613",
    clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
    id: () => "event-max",
  });
  ring.append({ type: "session.removed", sessionId: "session-1" });
  assert.equal(ring.currentCursor().offset, "18446744073709551614");
  assert.equal(
    ring.replayAfter({ epoch: "runtime-generation-1", offset: "0" }).kind,
    "epoch-changed",
  );
  assert.equal(
    ring.replayAfter({ epoch: "runtime-generation-2", offset: "18446744073709551615" }).kind,
    "cursor-gap",
  );
  assert.equal(
    ring.replayAfter({ epoch: "runtime-generation-2", offset: "18446744073709551613" }).events
      ?.length,
    1,
  );
});

test("updates the mobile-safe projection atomically and assigns the applied cursor", () => {
  let ids = 0;
  const projection = createRemoteProjection({
    epoch: "epoch-1",
    clock: { now: () => new Date("2026-09-13T20:00:00.000Z") },
    id: () => `event-${++ids}`,
  });
  const first = projection.upsertSession(session("session-1"));
  assert.equal(first.cursor.offset, "1");
  const changed = projection.changeRunState("session-1", "running");
  assert.equal(changed.cursor.offset, "2");
  assert.equal(projection.snapshot().sessions[0]?.runState, "running");
  assert.throws(
    () => projection.upsertSession({ ...session("session-2"), title: "/private/".repeat(100) }),
    /projection_event_invalid/u,
  );
  assert.equal(projection.currentCursor().offset, "2");
  assert.deepEqual(projection.removeSession("session-1").cursor, {
    epoch: "epoch-1",
    offset: "3",
  });
  assert.deepEqual(projection.snapshot().sessions, []);
});

test("captures a base cursor, chunks a snapshot, then replays concurrent events", async () => {
  let release!: (sessions: readonly RemoteSessionSummaryV1[]) => void;
  const pending = new Promise<readonly RemoteSessionSummaryV1[]>((resolve) => {
    release = resolve;
  });
  const service = createRemoteSnapshotService({
    id: () => "snapshot-1",
    currentCursor: () => ({ epoch: "epoch-1", offset: "7" }),
    readSessions: () => pending,
  });
  const creating = service.create();
  const concurrentEvent = {
    type: "sync.event",
    eventId: "event-8",
    cursor: { epoch: "epoch-1", offset: "8" },
    createdAt: "2026-09-13T20:00:08.000Z",
    payload: { type: "session.removed", sessionId: "session-8" },
  } as const;
  service.buffer(concurrentEvent);
  release(Array.from({ length: 120 }, (_, index) => session(`session-${index}`)));
  const result = await creating;
  assert.equal(result.chunks.length, 3);
  assert.equal(
    result.chunks.every(({ partCount }) => partCount === 3),
    true,
  );
  assert.deepEqual(result.complete, {
    type: "snapshot.complete",
    snapshotId: "snapshot-1",
    baseCursor: { epoch: "epoch-1", offset: "7" },
  });
  assert.deepEqual(result.replay, [concurrentEvent]);
});

test("aborts a snapshot when its concurrent event buffer overflows", async () => {
  let release!: (sessions: readonly RemoteSessionSummaryV1[]) => void;
  const service = createRemoteSnapshotService({
    id: () => "snapshot-overflow",
    currentCursor: () => ({ epoch: "epoch-1", offset: "0" }),
    readSessions: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    maximumBufferedEvents: 1,
  });
  const creating = service.create();
  const event = {
    type: "sync.event",
    eventId: "event-1",
    cursor: { epoch: "epoch-1", offset: "1" },
    createdAt: "2026-09-13T20:00:01.000Z",
    payload: { type: "session.removed", sessionId: "session-1" },
  } as const;
  service.buffer(event);
  service.buffer({ ...event, eventId: "event-2", cursor: { ...event.cursor, offset: "2" } });
  release([]);
  await assert.rejects(creating, /snapshot_required/u);
});
