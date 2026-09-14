import assert from "node:assert/strict";
import test from "node:test";

import type {
  RemoteEventV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import { createRemoteRecoveryCoordinator } from "../src/recovery.ts";
import { createRemoteSynchronizationState } from "../src/synchronization.ts";

const event = (epoch: string, offset: string): RemoteEventV1 => ({
  type: "sync.event",
  eventId: `event-${epoch}-${offset}`,
  cursor: { epoch, offset },
  createdAt: "2026-09-13T20:00:00.000Z",
  payload: { type: "session.removed", sessionId: "session-1" },
});

test("applies exact-next events, ignores duplicates, and stops on gap or epoch change", async () => {
  const applied: string[] = [];
  const synchronization = createRemoteSynchronizationState({
    initialCursor: { epoch: "epoch-1", offset: "7" },
    projection: {
      applyEvent: async (value) => void applied.push(value.cursor.offset),
      replaceSnapshot: async () => {},
    },
  });
  assert.equal((await synchronization.receiveEvent(event("epoch-1", "7"))).kind, "duplicate");
  assert.equal((await synchronization.receiveEvent(event("epoch-1", "8"))).kind, "applied");
  assert.equal(
    (await synchronization.receiveEvent(event("epoch-1", "10"))).kind,
    "snapshot-required",
  );
  assert.equal(
    (await synchronization.receiveEvent(event("epoch-2", "1"))).kind,
    "snapshot-required",
  );
  assert.deepEqual(applied, ["8"]);
  assert.equal(synchronization.snapshot().status, "snapshot-required");
});

test("assembles a complete snapshot transaction and rejects incomplete or mismatched frames", async () => {
  const replaced: Array<{ sessions: readonly RemoteSessionSummaryV1[]; offset: string }> = [];
  const synchronization = createRemoteSynchronizationState({
    projection: {
      applyEvent: async () => {},
      replaceSnapshot: async (sessions, cursor) =>
        void replaced.push({ sessions, offset: cursor.offset }),
    },
  });
  const session: RemoteSessionSummaryV1 = {
    sessionId: "session-1",
    title: "Session",
    updatedAt: "2026-09-13T20:00:00.000Z",
    pinned: false,
    archived: false,
    attention: "none",
    runState: "idle",
    entityRevision: "revision-1",
  };
  synchronization.receiveSnapshotChunk({
    type: "snapshot.chunk",
    snapshotId: "snapshot-1",
    partIndex: 1,
    partCount: 2,
    sessions: [],
  });
  synchronization.receiveSnapshotChunk({
    type: "snapshot.chunk",
    snapshotId: "snapshot-1",
    partIndex: 0,
    partCount: 2,
    sessions: [session],
  });
  await synchronization.completeSnapshot({
    type: "snapshot.complete",
    snapshotId: "snapshot-1",
    baseCursor: { epoch: "epoch-2", offset: "11" },
  });
  assert.deepEqual(replaced, [{ sessions: [session], offset: "11" }]);
  assert.equal(synchronization.snapshot().status, "ready");
  assert.deepEqual(synchronization.snapshot().cursor, { epoch: "epoch-2", offset: "11" });

  synchronization.receiveSnapshotChunk({
    type: "snapshot.chunk",
    snapshotId: "snapshot-incomplete",
    partIndex: 0,
    partCount: 2,
    sessions: [],
  });
  await assert.rejects(
    synchronization.completeSnapshot({
      type: "snapshot.complete",
      snapshotId: "snapshot-incomplete",
      baseCursor: { epoch: "epoch-2", offset: "12" },
    }),
    /snapshot_required/u,
  );
});

test("coordinates 1–30 second jitter, unresolved status recovery, and foreground triggers", () => {
  const recovery = createRemoteRecoveryCoordinator({ random: () => 0.999_999 });
  assert.equal(recovery.nextDelay(0), 1_000);
  assert.equal(recovery.nextDelay(20) <= 30_000, true);
  assert.deepEqual(
    recovery.resume({ epoch: "epoch-1", offset: "9" }, ["operation-1", "operation-2"]),
    {
      cursor: { epoch: "epoch-1", offset: "9" },
      unresolvedOperationIds: ["operation-1", "operation-2"],
    },
  );
  assert.deepEqual(recovery.suspend(), { closeSocket: true, reconnect: false });
  assert.deepEqual(recovery.networkChanged(), { reconnect: false });
  assert.deepEqual(recovery.foreground(), { reconnect: true, immediate: true });
  assert.deepEqual(recovery.networkChanged(), { reconnect: true, immediate: true });
});
