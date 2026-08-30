import assert from "node:assert/strict";
import test from "node:test";

import type { ThreadAssistantMessage, ThreadMessage } from "@assistant-ui/react";

import {
  aggregateWorkbenchSessionStatistics,
  mergeMonotonicWorkbenchSessionStatistics,
} from "../src/message-statistics";

function assistant(custom: Record<string, unknown>): ThreadAssistantMessage {
  return {
    id: "assistant",
    role: "assistant",
    content: [{ type: "text", text: "Done" }],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom,
    },
  };
}

test("aggregates Workbench-owned usage and turn statistics across a session", () => {
  const messages = [
    {
      id: "user",
      role: "user",
      content: [{ type: "text", text: "Question" }],
      createdAt: new Date(0),
      attachments: [],
      metadata: { custom: {} },
    },
    assistant({
      workbenchUsage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
    }),
    assistant({
      workbenchTurnStatistics: {
        steps: 2,
        llmDurationMs: 100,
        toolDurationMs: 0,
        firstTokenDurationMs: 20,
        firstTokenSamples: 1,
        inputTokens: 12,
        outputTokens: 6,
        cacheReadTokens: 3,
        cacheWriteTokens: 1,
      },
    }),
  ] as readonly ThreadMessage[];

  assert.deepEqual(aggregateWorkbenchSessionStatistics(messages), {
    turns: 1,
    steps: 3,
    llmDurationMs: 100,
    toolDurationMs: 0,
    firstTokenDurationMs: 20,
    firstTokenSamples: 1,
    inputTokens: 22,
    outputTokens: 11,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
  });
});

test("merges asynchronously observed totals monotonically", () => {
  const previous = {
    turns: 2,
    steps: 3,
    llmDurationMs: 100,
    toolDurationMs: 20,
    firstTokenDurationMs: 15,
    firstTokenSamples: 1,
    inputTokens: 20,
    outputTokens: 10,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
  };
  const current = { ...previous, turns: 1, steps: 4, outputTokens: 12 };

  assert.deepEqual(mergeMonotonicWorkbenchSessionStatistics(previous, current), {
    ...previous,
    steps: 4,
    outputTokens: 12,
  });
});
