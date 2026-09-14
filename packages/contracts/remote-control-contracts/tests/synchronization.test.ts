import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRemoteCursor,
  parseRemoteErrorV1,
  parseRemoteEventV1,
  parseRemoteSnapshotChunkV1,
  parseRemoteSnapshotCompleteV1,
} from "../src/codecs.ts";

const session = {
  sessionId: "session-1",
  title: "Session",
  updatedAt: "2026-09-13T20:00:00.000Z",
  pinned: false,
  archived: false,
  attention: "none",
  runState: "idle",
  entityRevision: "revision-1",
} as const;

test("accepts canonical uint64 duplicate/exact-next/gap/epoch cursor coordinates", () => {
  for (const cursor of [
    { epoch: "epoch-1", offset: "7" },
    { epoch: "epoch-1", offset: "8" },
    { epoch: "epoch-1", offset: "10" },
    { epoch: "epoch-2", offset: "1" },
    { epoch: "epoch-max", offset: "18446744073709551615" },
  ]) {
    assert.deepEqual(parseRemoteCursor(cursor), cursor);
  }
  for (const offset of ["", "00", "01", "+1", "-1", "1.0", "18446744073709551616"]) {
    assert.equal(parseRemoteCursor({ epoch: "epoch-1", offset }), undefined);
  }
});

test("strictly parses bounded contiguous event and snapshot frames", () => {
  const { title: _title, ...untitledSession } = session;
  const event = {
    type: "sync.event",
    eventId: "event-8",
    cursor: { epoch: "epoch-1", offset: "8" },
    createdAt: "2026-09-13T20:00:08.000Z",
    payload: { type: "session.upserted", session },
  } as const;
  assert.deepEqual(parseRemoteEventV1(event), event);
  assert.equal(
    parseRemoteEventV1({ ...event, cursor: { epoch: "epoch-1", offset: "08" } }),
    undefined,
  );
  assert.equal(
    parseRemoteEventV1({ ...event, payload: { ...event.payload, path: "/private" } }),
    undefined,
  );

  const chunk = {
    type: "snapshot.chunk",
    snapshotId: "snapshot-1",
    partIndex: 0,
    partCount: 2,
    sessions: [session],
  } as const;
  const complete = {
    type: "snapshot.complete",
    snapshotId: "snapshot-1",
    baseCursor: { epoch: "epoch-1", offset: "8" },
  } as const;
  assert.deepEqual(parseRemoteSnapshotChunkV1(chunk), chunk);
  assert.deepEqual(parseRemoteSnapshotChunkV1({ ...chunk, sessions: [untitledSession] }), {
    ...chunk,
    sessions: [untitledSession],
  });
  assert.equal(
    parseRemoteSnapshotChunkV1({ ...chunk, sessions: [{ ...session, title: "" }] }),
    undefined,
  );
  assert.deepEqual(parseRemoteSnapshotCompleteV1(complete), complete);
  assert.equal(parseRemoteSnapshotChunkV1({ ...chunk, partIndex: 2 }), undefined);
  assert.equal(
    parseRemoteSnapshotChunkV1({ ...chunk, sessions: Array(201).fill(session) }),
    undefined,
  );
  assert.equal(parseRemoteSnapshotCompleteV1({ ...complete, extra: true }), undefined);
});

test("retains stable cursor-expired and snapshot-required wire failures", () => {
  for (const code of ["cursor_expired", "snapshot_required"] as const) {
    assert.deepEqual(parseRemoteErrorV1({ type: "remote.error", version: 1, code }), {
      type: "remote.error",
      version: 1,
      code,
    });
  }
});
