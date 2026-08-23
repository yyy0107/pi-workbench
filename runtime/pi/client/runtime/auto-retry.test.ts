import assert from "node:assert/strict";
import test from "node:test";

import { piAutoRetryFromEvent, piAutoRetryFromHistory } from "./auto-retry";

test("parses validated automatic-retry progress from a live event", () => {
  assert.deepEqual(piAutoRetryFromEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 3 }), {
    attempt: 2,
    maxAttempts: 3,
  });
  assert.equal(
    piAutoRetryFromEvent({ type: "auto_retry_start", attempt: 4, maxAttempts: 3 }),
    undefined,
  );
  assert.equal(piAutoRetryFromEvent({ type: "agent_start" }), undefined);
});

test("restores the latest retry until canonical history reports settlement", () => {
  const runningHistory = {
    events: [
      {
        event: {
          type: "auto_retry_start",
          seq: 1,
          time: 1,
          data: { attempt: 1, maxAttempts: 3 },
        },
      },
      {
        event: {
          type: "auto_retry_start",
          seq: 2,
          time: 2,
          data: { attempt: 2, maxAttempts: 3 },
        },
      },
      {
        event: {
          type: "auto_retry_end",
          seq: 3,
          time: 3,
          data: { success: false, attempt: 2 },
        },
      },
    ],
    hasMore: false,
  };

  assert.deepEqual(piAutoRetryFromHistory(runningHistory), { attempt: 2, maxAttempts: 3 });
  assert.equal(
    piAutoRetryFromHistory({
      ...runningHistory,
      events: [
        ...runningHistory.events,
        { event: { type: "agent_settled", seq: 4, time: 4, data: {} } },
      ],
    }),
    undefined,
  );
});
