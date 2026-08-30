import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkbenchConversationEvent,
  parseWorkbenchMessageTermination,
  readWorkbenchMessageStateToken,
  readWorkbenchMessageUsage,
  readWorkbenchTurnStatistics,
  readWorkbenchTurnTiming,
  resolveWorkbenchTurnDuration,
} from "../src/message-metadata";

test("parses backend-neutral lifecycle, usage, timing, and state metadata", () => {
  assert.deepEqual(
    parseWorkbenchMessageTermination({
      schemaVersion: 1,
      kind: "cancelled",
      stopReason: "aborted",
      source: "workbench",
    }),
    {
      schemaVersion: 1,
      kind: "cancelled",
      stopReason: "aborted",
      source: "workbench",
    },
  );
  assert.deepEqual(
    readWorkbenchMessageUsage({ input: 4, output: 3, cacheRead: 2, cacheWrite: 1 }),
    { input: 4, output: 3, cacheRead: 2, cacheWrite: 1 },
  );
  assert.deepEqual(readWorkbenchTurnTiming({ startedAt: 10, completedAt: 25 }), {
    startedAt: 10,
    completedAt: 25,
  });
  assert.equal(resolveWorkbenchTurnDuration({ startedAt: 10, completedAt: 25 }), 15);
  assert.equal(readWorkbenchMessageStateToken("42"), "42");
});

test("parses generic conversation events and aggregate turn statistics", () => {
  assert.deepEqual(
    parseWorkbenchConversationEvent({
      kind: "model-change",
      provider: "provider",
      model: "model",
    }),
    { kind: "model-change", provider: "provider", model: "model" },
  );
  assert.deepEqual(
    readWorkbenchTurnStatistics({
      steps: 2,
      llmDurationMs: 100,
      toolDurationMs: 20,
      firstTokenDurationMs: 10,
      firstTokenSamples: 1,
      inputTokens: 50,
      outputTokens: 25,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
    }),
    {
      steps: 2,
      llmDurationMs: 100,
      toolDurationMs: 20,
      firstTokenDurationMs: 10,
      firstTokenSamples: 1,
      inputTokens: 50,
      outputTokens: 25,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
    },
  );
});

test("rejects malformed metadata instead of leaking backend assumptions", () => {
  assert.equal(parseWorkbenchMessageTermination({ schemaVersion: 1, kind: "native" }), undefined);
  assert.equal(readWorkbenchMessageUsage({ input: -1 }), undefined);
  assert.equal(readWorkbenchTurnTiming({ startedAt: 20, completedAt: 10 }), undefined);
  assert.equal(readWorkbenchTurnStatistics({ steps: -1 }), undefined);
  assert.equal(readWorkbenchMessageStateToken(42), undefined);
});
