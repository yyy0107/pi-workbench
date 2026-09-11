import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchSessionStatistics } from "@workbench/agent-runtime-client/message-statistics";

import { sessionTokensPerSecond } from "./token-throughput";

const STATISTICS: WorkbenchSessionStatistics = {
  turns: 1,
  steps: 2,
  llmDurationMs: 6_000,
  decodeDurationMs: 5_000,
  toolDurationMs: 0,
  firstTokenDurationMs: 1_000,
  firstTokenSamples: 2,
  inputTokens: 1_000,
  outputTokens: 100,
  reasoningTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  liveGeneratedTokens: 25,
  liveDecodeDurationMs: 1_000,
};

test("uses only the active model step for live throughput", () => {
  assert.equal(sessionTokensPerSecond(STATISTICS, true), 25);
});

test("does not add the active estimate after the session settles", () => {
  assert.equal(sessionTokensPerSecond(STATISTICS, false), 30);
});

test("waits for generated time before reporting throughput", () => {
  assert.equal(sessionTokensPerSecond({ ...STATISTICS, liveDecodeDurationMs: 0 }, true), undefined);
});

test("does not dilute the current step with settled conversation totals", () => {
  assert.equal(
    sessionTokensPerSecond(
      {
        ...STATISTICS,
        outputTokens: 10_000,
        reasoningTokens: 5_000,
        decodeDurationMs: 600_000,
      },
      true,
    ),
    25,
  );
});

test("does not show a settled average while a new step is waiting for its first token", () => {
  const { liveGeneratedTokens: _tokens, liveDecodeDurationMs: _duration, ...settled } = STATISTICS;
  assert.equal(sessionTokensPerSecond(settled, true), undefined);
});
