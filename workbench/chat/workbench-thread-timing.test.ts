import assert from "node:assert/strict";
import test from "node:test";

import { currentRunStartedAt, piAutoRetryStatus, piRunStartedAt } from "./workbench-thread-timing";

test("reads a stable runtime-owned Pi run start", () => {
  assert.equal(piRunStartedAt({ piRun: { startedAt: 12_345 } }), 12_345);
  assert.equal(piRunStartedAt({ piRun: { startedAt: Number.NaN } }), undefined);
  assert.equal(piRunStartedAt({}), undefined);
});

test("reads only valid automatic-retry state from Pi runtime extras", () => {
  const retry = { attempt: 2, maxAttempts: 3 };
  assert.equal(piAutoRetryStatus({ piRun: { autoRetry: retry } }), retry);
  assert.equal(
    piAutoRetryStatus({ piRun: { autoRetry: { attempt: 0, maxAttempts: 3 } } }),
    undefined,
  );
  assert.equal(
    piAutoRetryStatus({ piRun: { autoRetry: { attempt: 4, maxAttempts: 3 } } }),
    undefined,
  );
  assert.equal(piAutoRetryStatus({ piRun: {} }), undefined);
});

test("keeps the running turn anchored to the latest user message across remounts", () => {
  const messages = [
    { role: "user", createdAt: new Date(1_000) },
    {
      role: "assistant",
      createdAt: new Date(1_500),
      metadata: { timing: { streamStartTime: 1_400 } },
    },
    { role: "user", createdAt: new Date(10_000) },
    {
      role: "assistant",
      createdAt: new Date(10_500),
      metadata: { timing: { streamStartTime: 10_400 } },
    },
  ];

  assert.equal(currentRunStartedAt(messages), 10_000);
  assert.equal(currentRunStartedAt(messages), 10_000);
});

test("falls back to the assistant stream time when no user message is available", () => {
  assert.equal(
    currentRunStartedAt([
      {
        role: "assistant",
        createdAt: new Date(10_500),
        metadata: { timing: { streamStartTime: 10_400 } },
      },
    ]),
    10_400,
  );
});

test("keeps the current run start when a steering user message is appended", () => {
  assert.equal(
    currentRunStartedAt([
      { role: "user", createdAt: new Date(10_000) },
      {
        role: "assistant",
        createdAt: new Date(10_500),
        metadata: { timing: { streamStartTime: 10_400 } },
      },
      {
        role: "user",
        createdAt: new Date(25_000),
        metadata: { custom: { piSteering: true } },
      },
    ]),
    10_000,
  );
});
