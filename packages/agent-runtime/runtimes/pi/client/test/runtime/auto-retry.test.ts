import assert from "node:assert/strict";
import test from "node:test";

import type { PiEvent } from "@workbench/agent-runtime-pi-protocol/messages";
import {
  piAutoRetryFromEvent,
  piAutoRetryFromHistory,
  piAutoRetryRecovered,
} from "../../src/runtime/auto-retry";

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

test("clears live and restored retry progress when model output resumes or retry succeeds", () => {
  const retry = {
    event: {
      type: "auto_retry_start",
      seq: 1,
      time: 1,
      data: { attempt: 1, maxAttempts: 3 },
    },
  };
  const recoveries: PiEvent[] = [
    { type: "auto_retry_end", success: true, attempt: 1 },
    ...[
      { type: "text", text: "Recovered" },
      { type: "thinking", thinking: "Thinking again" },
      { type: "toolCall", id: "tool-1", name: "read", arguments: {} },
    ].map((part) => ({
      type: "message_update",
      message: { role: "assistant", content: [part] },
    })),
    {
      type: "message_update",
      format: "pi-messages-v1",
      streamId: "stream-1",
      firstRevision: 1,
      revision: 2,
      startSeq: 2,
      message: { role: "assistant" },
      updates: [
        { type: "text_start", contentIndex: 0 },
        { type: "text_delta", contentIndex: 0, delta: "Recovered" },
      ],
    },
  ];
  const waiting: PiEvent[] = [
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", message: { role: "assistant", content: [] } },
    { type: "auto_retry_end", success: false, attempt: 1 },
  ];

  for (const event of [...waiting, ...recoveries]) {
    const { type, ...data } = event;
    const recovered = recoveries.includes(event);
    assert.equal(piAutoRetryRecovered(type, data), recovered);
    const history = {
      events: [retry, { event: { type, seq: 3, time: 3, data } }],
      hasMore: false,
    };
    assert.deepEqual(
      piAutoRetryFromHistory(history),
      recovered ? undefined : { attempt: 1, maxAttempts: 3 },
    );
    assert.deepEqual(
      piAutoRetryFromHistory({
        ...history,
        events: [...history.events, { event: { ...retry.event, seq: 4, time: 4 } }],
      }),
      { attempt: 1, maxAttempts: 3 },
      "a later failure starts a new retry after recovery",
    );
  }
});
