import assert from "node:assert/strict";
import test from "node:test";

import { currentRunStartedAt } from "./workbench-thread-timing";

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
