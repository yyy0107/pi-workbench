import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssistantMessageNode,
  ConversationData,
  ConversationNode,
} from "@workbench/agent-runtime-contracts/conversation";

import {
  aggregateWorkbenchSessionStatistics,
  mergeMonotonicWorkbenchSessionStatistics,
} from "../src/message-statistics";

function assistant(custom: Record<string, ConversationData>): AssistantMessageNode {
  return {
    key: "assistant",
    kind: "assistant",
    blocks: [{ key: "text", kind: "text", text: "Done" }],
    status: "complete",
    createdAt: 0,
    presentation: { custom },
  };
}

test("aggregates Workbench-owned usage and turn statistics across a session", () => {
  const messages = [
    {
      key: "user",
      kind: "user",
      blocks: [{ key: "text", kind: "text", text: "Question" }],
      createdAt: 0,
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
  ] as readonly ConversationNode[];

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
