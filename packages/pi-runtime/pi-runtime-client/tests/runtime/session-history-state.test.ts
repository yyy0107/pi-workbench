import assert from "node:assert/strict";
import test from "node:test";

import { PiClientSessionHistoryState } from "../../src/runtime/session-history";

test("history state invalidates generations and releases every owned projection on dispose", () => {
  const history = new PiClientSessionHistoryState();
  history.hasMore = true;
  history.lastSequence = 42;
  history.loadedHistory = { events: [], hasMore: true };
  history.branchLeafByHeadMessageId.set("head", "leaf");
  history.baseMessageRepository = { headId: "head", messages: [] };
  const generation = history.rebaselineGeneration;

  history.dispose();

  assert.equal(history.rebaselineGeneration, generation + 1);
  assert.equal(history.hasMore, false);
  assert.equal(history.lastSequence, -1);
  assert.equal(history.loadedHistory, undefined);
  assert.equal(history.branchLeafByHeadMessageId.size, 0);
  assert.deepEqual(history.baseMessageRepository, { headId: null, messages: [] });
});

test("history state rejects stale sequences and de-duplicates overlapping older pages", () => {
  const history = new PiClientSessionHistoryState();
  assert.equal(history.acceptSequence(5), true);
  assert.equal(history.acceptSequence(5), false);
  assert.equal(history.acceptSequence(4), false);
  assert.equal(history.acceptSequence(6), true);
  history.loadedHistory = {
    events: [{ event: { seq: 5, entryId: "same" } } as never],
    hasMore: false,
  };
  const merged = history.mergeOlder({
    events: [
      { event: { seq: 3, entryId: "older" } } as never,
      { event: { seq: 4, entryId: "same" } } as never,
    ],
    hasMore: true,
  });
  assert.deepEqual(
    merged.events.map(({ event }) => event.entryId),
    ["older", "same"],
  );
  assert.equal(merged.hasMore, true);
});
