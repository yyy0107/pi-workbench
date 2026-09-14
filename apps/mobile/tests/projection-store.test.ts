import assert from "node:assert/strict";
import test from "node:test";

import type {
  RemoteCursor,
  RemoteEventV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import {
  createMobileProjectionStore,
  type MobileProjectionPersistencePort,
} from "../src/state/projection-store.ts";

function session(title = "会话🙂"): RemoteSessionSummaryV1 {
  return {
    sessionId: "session-1",
    title,
    updatedAt: "2026-09-13T20:00:00.000Z",
    pinned: false,
    archived: false,
    attention: "none",
    runState: "idle",
    entityRevision: "revision-1",
  };
}

function event(offset: string, payload: RemoteEventV1["payload"]): RemoteEventV1 {
  return {
    type: "sync.event",
    eventId: `event-${offset}`,
    cursor: { epoch: "epoch-1", offset },
    createdAt: "2026-09-13T20:00:00.000Z",
    payload,
  };
}

function memoryPersistence() {
  let value:
    | {
        readonly sessions: readonly RemoteSessionSummaryV1[];
        readonly cursor: RemoteCursor;
        readonly stale: boolean;
      }
    | undefined;
  let fail = false;
  const drafts = new Map([["session-1", "本地草稿🙂"]]);
  const persistence: MobileProjectionPersistencePort = {
    load: async () => (value ? structuredClone(value) : undefined),
    replace: async (_machineId, next) => {
      if (fail) throw new Error("storage_failure");
      value = structuredClone(next);
    },
    markStale: async () => {
      if (value) value = { ...value, stale: true };
    },
  };
  return {
    persistence,
    drafts,
    read: () => value,
    fail: (next: boolean) => void (fail = next),
  };
}

test("commits a snapshot and contiguous event batch while preserving a local draft", async () => {
  const memory = memoryPersistence();
  const store = createMobileProjectionStore({ persistence: memory.persistence });
  await store.replaceSnapshot("machine-1", [session()], { epoch: "epoch-1", offset: "7" });
  await store.applyEvents("machine-1", [
    event("8", { type: "session.runChanged", sessionId: "session-1", runState: "running" }),
    event("9", {
      type: "session.upserted",
      session: { ...session(), entityRevision: "revision-2" },
    }),
  ]);
  assert.equal(memory.read()?.cursor.offset, "9");
  assert.equal(memory.read()?.sessions[0]?.entityRevision, "revision-2");
  assert.equal(memory.drafts.get("session-1"), "本地草稿🙂");
  assert.equal(memory.read()?.stale, false);
});

test("rejects gap/epoch and rolls back snapshot or event state on storage failure", async () => {
  const memory = memoryPersistence();
  const store = createMobileProjectionStore({ persistence: memory.persistence });
  await store.replaceSnapshot("machine-1", [session()], { epoch: "epoch-1", offset: "1" });
  await assert.rejects(
    store.applyEvents("machine-1", [
      event("3", { type: "session.removed", sessionId: "session-1" }),
    ]),
    /snapshot_required/u,
  );
  assert.equal(memory.read()?.cursor.offset, "1");

  memory.fail(true);
  await assert.rejects(
    store.replaceSnapshot("machine-1", [{ ...session(), title: "新标题" }], {
      epoch: "epoch-2",
      offset: "0",
    }),
    /storage_failure/u,
  );
  assert.equal(memory.read()?.sessions[0]?.title, "会话🙂");
  assert.deepEqual(memory.read()?.cursor, { epoch: "epoch-1", offset: "1" });
});

test("bounds snapshot retention and UTF-8/long-line payload validation", async () => {
  const memory = memoryPersistence();
  const store = createMobileProjectionStore({ persistence: memory.persistence });
  await store.replaceSnapshot(
    "machine-1",
    Array.from({ length: 200 }, (_, index) => ({
      ...session(`会话-${index}-🙂`),
      sessionId: `session-${index}`,
      entityRevision: `revision-${index}`,
    })),
    { epoch: "epoch-1", offset: "0" },
  );
  assert.equal((await store.load("machine-1"))?.sessions.length, 200);
  await assert.rejects(
    store.replaceSnapshot(
      "machine-1",
      Array.from({ length: 201 }, (_, index) => ({
        ...session(),
        sessionId: `session-${index}`,
        entityRevision: `revision-${index}`,
      })),
      { epoch: "epoch-1", offset: "0" },
    ),
    /snapshot_required/u,
  );
  await assert.rejects(
    store.replaceSnapshot("machine-1", [session("界".repeat(513))], {
      epoch: "epoch-1",
      offset: "0",
    }),
    /snapshot_required/u,
  );
});
