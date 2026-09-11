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
      workbenchUsage: { input: 10, output: 5, reasoning: 2, cacheRead: 2, cacheWrite: 1 },
    }),
    assistant({
      workbenchTurnStatistics: {
        steps: 2,
        llmDurationMs: 100,
        decodeDurationMs: 80,
        toolDurationMs: 0,
        firstTokenDurationMs: 20,
        firstTokenSamples: 1,
        inputTokens: 12,
        outputTokens: 6,
        reasoningTokens: 0,
        cacheReadTokens: 3,
        cacheWriteTokens: 1,
      },
    }),
  ] as readonly ConversationNode[];

  assert.deepEqual(aggregateWorkbenchSessionStatistics(messages), {
    turns: 1,
    steps: 3,
    llmDurationMs: 100,
    decodeDurationMs: 80,
    toolDurationMs: 0,
    firstTokenDurationMs: 20,
    firstTokenSamples: 1,
    inputTokens: 22,
    outputTokens: 11,
    reasoningTokens: 2,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
  });
});

test("merges asynchronously observed totals monotonically", () => {
  const previous = {
    turns: 2,
    steps: 3,
    llmDurationMs: 100,
    decodeDurationMs: 80,
    toolDurationMs: 20,
    firstTokenDurationMs: 15,
    firstTokenSamples: 1,
    inputTokens: 20,
    outputTokens: 10,
    reasoningTokens: 0,
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

test("counts streamed text and reasoning only for live throughput", () => {
  const messages = [
    {
      key: "user",
      kind: "user",
      blocks: [{ key: "text", kind: "text", text: "Question" }],
    },
    {
      key: "assistant",
      kind: "assistant",
      blocks: [
        { key: "reasoning", kind: "reasoning", text: "Thinking" },
        { key: "text", kind: "text", text: "Answer" },
      ],
      status: "running",
      presentation: {
        timing: { streamStartTime: 1_000, firstTokenTime: 100, tokenCount: 4 },
      },
    },
  ] as readonly ConversationNode[];

  assert.deepEqual(aggregateWorkbenchSessionStatistics(messages, 2_000), {
    turns: 1,
    steps: 1,
    llmDurationMs: 1_000,
    decodeDurationMs: 0,
    toolDurationMs: 0,
    firstTokenDurationMs: 100,
    firstTokenSamples: 1,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    liveGeneratedTokens: 4,
    liveDecodeDurationMs: 900,
  });
});

test("keeps the live estimate when a streaming node already has zeroed turn statistics", () => {
  const messages = [
    {
      key: "assistant",
      kind: "assistant",
      blocks: [{ key: "reasoning", kind: "reasoning", text: "Thinking" }],
      status: "running",
      presentation: {
        custom: {
          workbenchTurnStatistics: {
            steps: 1,
            llmDurationMs: 0,
            decodeDurationMs: 0,
            toolDurationMs: 0,
            firstTokenDurationMs: 0,
            firstTokenSamples: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        },
        timing: { streamStartTime: 1_000, firstTokenTime: 100, tokenCount: 2 },
      },
    },
  ] as readonly ConversationNode[];

  assert.equal(aggregateWorkbenchSessionStatistics(messages, 2_000).liveGeneratedTokens, 2);
  assert.equal(aggregateWorkbenchSessionStatistics(messages, 2_000).liveDecodeDurationMs, 900);
});

test("adds the active estimate after completed model steps in the same assistant turn", () => {
  const messages = [
    {
      key: "assistant",
      kind: "assistant",
      blocks: [{ key: "text", kind: "text", text: "Current answer" }],
      status: "running",
      presentation: {
        custom: {
          workbenchTurnStatistics: {
            steps: 2,
            llmDurationMs: 1_000,
            decodeDurationMs: 900,
            toolDurationMs: 100,
            firstTokenDurationMs: 100,
            firstTokenSamples: 1,
            inputTokens: 10,
            outputTokens: 80,
            reasoningTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        },
        timing: { streamStartTime: 2_000, firstTokenTime: 100, tokenCount: 5 },
      },
    },
  ] as readonly ConversationNode[];

  const statistics = aggregateWorkbenchSessionStatistics(messages, 3_000);
  assert.equal(statistics.outputTokens, 80);
  assert.equal(statistics.reasoningTokens, 20);
  assert.equal(statistics.liveGeneratedTokens, 5);
  assert.equal(statistics.decodeDurationMs, 900);
  assert.equal(statistics.liveDecodeDurationMs, 900);
});

test("takes the current stream estimate after a previous model step becomes final", () => {
  const previous = {
    turns: 1,
    steps: 1,
    llmDurationMs: 1_000,
    decodeDurationMs: 900,
    toolDurationMs: 0,
    firstTokenDurationMs: 100,
    firstTokenSamples: 1,
    inputTokens: 10,
    outputTokens: 90,
    reasoningTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    liveGeneratedTokens: 100,
    liveDecodeDurationMs: 900,
  };
  const current = {
    ...previous,
    steps: 2,
    outputTokens: 180,
    reasoningTokens: 20,
    liveGeneratedTokens: 5,
    liveDecodeDurationMs: 100,
  };

  const merged = mergeMonotonicWorkbenchSessionStatistics(previous, current);
  assert.equal(merged.liveGeneratedTokens, 5);
  assert.equal(merged.liveDecodeDurationMs, 100);
});
