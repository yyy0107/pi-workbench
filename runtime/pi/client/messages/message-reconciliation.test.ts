import assert from "node:assert/strict";
import test from "node:test";

import { piAssistantToThreadMessage, reconcileLiveMessagesAfterHistory } from "./messages";

function assistantMessage(id: string, eventSeq: number) {
  return piAssistantToThreadMessage(
    {
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      usage: {
        input: 100,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 110,
      },
    },
    id,
    { eventSeq },
  );
}

test("removes a live message already captured by authoritative history", () => {
  const live = assistantMessage("assistant-live", 10);
  const authoritative = assistantMessage("assistant-authoritative", 10);

  assert.deepEqual(
    reconcileLiveMessagesAfterHistory([live], [authoritative], {
      // The live message arrived after history reload began, reproducing the race.
      liveMessageIdsAtStart: new Set(),
      baseMessageIdsAtStart: new Set(),
      preserveUnpersistedOptimisticUsers: true,
    }),
    [],
  );
});

test("retains a newer live message not present in authoritative history", () => {
  const live = assistantMessage("assistant-live", 11);
  const authoritative = assistantMessage("assistant-authoritative", 10);

  assert.deepEqual(
    reconcileLiveMessagesAfterHistory([live], [authoritative], {
      liveMessageIdsAtStart: new Set(),
      baseMessageIdsAtStart: new Set(),
      preserveUnpersistedOptimisticUsers: true,
    }),
    [live],
  );
});
