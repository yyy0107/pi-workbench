import assert from "node:assert/strict";
import test from "node:test";

import type { SessionEvent } from "@workbench/agent-runtime-pi-protocol/rpc";
const journalModule = (await import(
  new URL("../../src/sessions/session-event-journal.ts", import.meta.url).href
)) as typeof import("../../src/sessions/session-event-journal");
const {
  appendSessionEventJournal,
  createCanonicalSessionEvent,
  initializeSessionEventJournal,
  readSessionEventJournal,
  SESSION_EVENT_CUSTOM_TYPE,
  SESSION_EVENT_JOURNAL_CUSTOM_TYPE,
} = journalModule;
type SessionEventJournalStore =
  import("../../src/sessions/session-event-journal").SessionEventJournalStore;

class MemoryJournal implements SessionEventJournalStore {
  readonly entries: Array<{ id?: string; type: string; customType: string; data?: unknown }> = [];
  failAfter = Number.POSITIVE_INFINITY;

  getBranch() {
    return this.entries;
  }

  appendCustomEntry(customType: string, data?: unknown): string {
    if (this.entries.length >= this.failAfter) throw new Error("disk full");
    const id = `entry-${this.entries.length + 1}`;
    this.entries.push({ id, type: "custom", customType, data: structuredClone(data) });
    return id;
  }
}

function messageEvent(seq: number, text: string): SessionEvent {
  return {
    type: "message",
    seq,
    time: 1_000 + seq,
    data: { role: "user", content: text },
  };
}

test("empty journals use lastSeq -1 and the first event uses seq 0", () => {
  const store = new MemoryJournal();
  const initialized = initializeSessionEventJournal(store, []);
  assert.deepEqual(initialized, { events: [] });
  assert.equal(store.entries[0]?.customType, SESSION_EVENT_JOURNAL_CUSTOM_TYPE);

  const first = createCanonicalSessionEvent({ type: "agent_start", runId: "run-1" }, 0, 123);
  appendSessionEventJournal(store, first);
  assert.deepEqual(readSessionEventJournal(store), [
    {
      type: "agent_start",
      seq: 0,
      time: 123,
      data: { runId: "run-1" },
      entryId: "entry-2",
    },
  ]);
});

test("legacy migration is stable, resumable, and runs only once", () => {
  const store = new MemoryJournal();
  store.entries.push({
    type: "custom",
    customType: SESSION_EVENT_CUSTOM_TYPE,
    data: { version: 1, event: messageEvent(0, "one") },
  });

  const migrated = initializeSessionEventJournal(store, [
    messageEvent(0, "one"),
    messageEvent(1, "two"),
  ]);
  assert.deepEqual(migrated.events, [
    messageEvent(0, "one"),
    { ...messageEvent(1, "two"), entryId: "entry-2" },
  ]);
  assert.equal(store.entries.length, 3);

  const reopened = initializeSessionEventJournal(store, [
    messageEvent(0, "one"),
    messageEvent(1, "two"),
  ]);
  assert.deepEqual(reopened.events, migrated.events);
  assert.equal(store.entries.length, 3);
});

test("JSON-unsafe values and journal write failures do not corrupt the committed prefix", () => {
  const store = new MemoryJournal();
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.throws(
    () => createCanonicalSessionEvent({ type: "message_update", circular }, 0, 123),
    /circular|serializable/i,
  );
  assert.deepEqual(store.entries, []);

  store.failAfter = 1;
  const initialized = initializeSessionEventJournal(store, [
    messageEvent(0, "one"),
    messageEvent(1, "two"),
  ]);
  assert.deepEqual(initialized.events, [{ ...messageEvent(0, "one"), entryId: "entry-1" }]);
  assert.match(String(initialized.error), /disk full/);
  assert.deepEqual(readSessionEventJournal(store), [
    { ...messageEvent(0, "one"), entryId: "entry-1" },
  ]);
});
