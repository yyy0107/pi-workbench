import assert from "node:assert/strict";
import test from "node:test";

import type {
  SessionHistoryPayload,
  SessionHistoryValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  BACKFILL_SESSION_HISTORY_MESSAGES,
  fetchProgressiveSessionHistory,
  INITIAL_SESSION_HISTORY_MESSAGES,
  SessionHistoryPaginationError,
} from "../src/sessions/history-pagination";

function history(sequences: readonly number[], hasMore: boolean): SessionHistoryValue {
  return {
    events: sequences.map((seq) => ({
      event: { type: "message", seq, time: seq, data: { role: "user", content: String(seq) } },
    })),
    hasMore,
  };
}

test("publishes a small tail page before older history finishes loading", async () => {
  let releaseBackfill: (() => void) | undefined;
  const backfillGate = new Promise<void>((resolve) => {
    releaseBackfill = resolve;
  });
  let initialPagePainted: (() => void) | undefined;
  const initialPaint = new Promise<void>((resolve) => {
    initialPagePainted = resolve;
  });
  const calls: SessionHistoryPayload[] = [];

  const result = fetchProgressiveSessionHistory(
    "session-1",
    async (payload) => {
      calls.push(payload);
      if (payload.beforeSeq === undefined) {
        return {
          ...history([10, 11], true),
          resume: {
            checkpoint: {
              checkpointId: "checkpoint-1",
              terminalMessageId: "terminal-1",
              branchLeafId: "leaf-1",
              sourceEventSeq: 11,
              reason: "user-cancelled",
              capability: "ready",
              createdAt: 1_777_000_000_000,
            },
          },
        };
      }
      await backfillGate;
      return history([0, 1], false);
    },
    {
      onInitialPage(page) {
        assert.deepEqual(
          page.events.map(({ event }) => event.seq),
          [10, 11],
        );
        initialPagePainted?.();
      },
    },
  );

  await initialPaint;
  assert.deepEqual(calls, [
    { sessionId: "session-1", maxMessages: INITIAL_SESSION_HISTORY_MESSAGES },
    {
      sessionId: "session-1",
      beforeSeq: 10,
      maxMessages: BACKFILL_SESSION_HISTORY_MESSAGES,
    },
  ]);

  releaseBackfill?.();
  const resolved = await result;
  assert.deepEqual(
    resolved.events.map(({ event }) => event.seq),
    [0, 1, 10, 11],
  );
  assert.equal(resolved.resume?.checkpoint?.checkpointId, "checkpoint-1");
});

test("returns a complete first page without requesting a backfill", async () => {
  const calls: SessionHistoryPayload[] = [];
  const complete = history([0, 1], false);

  const result = await fetchProgressiveSessionHistory("session-1", async (payload) => {
    calls.push(payload);
    return complete;
  });

  assert.strictEqual(result, complete);
  assert.equal(calls.length, 1);
});

test("rejects a paginated response that cannot advance", async () => {
  await assert.rejects(
    fetchProgressiveSessionHistory("session-1", async () => history([], true)),
    SessionHistoryPaginationError,
  );
});
