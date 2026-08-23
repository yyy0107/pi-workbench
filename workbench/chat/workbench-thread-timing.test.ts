import assert from "node:assert/strict";
import test from "node:test";

import { currentRunStartedAt, piRunStartedAt } from "./workbench-thread-timing";

test("reads a stable runtime-owned Pi run start", () => {
  assert.equal(piRunStartedAt({ piRun: { startedAt: 12_345 } }), 12_345);
  assert.equal(piRunStartedAt({ piRun: { startedAt: Number.NaN } }), undefined);
  assert.equal(piRunStartedAt({}), undefined);
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
