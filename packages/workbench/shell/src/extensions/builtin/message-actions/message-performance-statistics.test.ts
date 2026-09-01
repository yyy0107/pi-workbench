import assert from "node:assert/strict";
import test from "node:test";

import { messageCacheHitRate, messageTokensPerSecond } from "./message-performance-statistics";

const TURN_STATISTICS = {
  steps: 2,
  llmDurationMs: 10_000,
  toolDurationMs: 100,
  firstTokenDurationMs: 500,
  firstTokenSamples: 2,
  inputTokens: 9_800,
  outputTokens: 198,
  cacheReadTokens: 10_200,
  cacheWriteTokens: 0,
} as const;

test("uses the token-weighted statistics for the whole assistant turn", () => {
  const rate = messageCacheHitRate({
    turnStatistics: TURN_STATISTICS,
    usage: {
      input: 100,
      output: 800,
      cacheRead: 9_900,
      cacheWrite: 0,
    },
  });

  assert.equal(rate, 0.51);
});

test("falls back to the final request usage for legacy messages", () => {
  assert.equal(
    messageCacheHitRate({
      usage: {
        input: 100,
        output: 800,
        cacheRead: 9_900,
        cacheWrite: 0,
      },
    }),
    0.99,
  );
});

test("omits the rate when no prompt tokens were reported", () => {
  assert.equal(
    messageCacheHitRate({ usage: { input: 0, output: 10, cacheRead: 0, cacheWrite: 0 } }),
    undefined,
  );
});

test("uses aggregate output throughput for the whole assistant turn", () => {
  assert.equal(
    messageTokensPerSecond({
      turnStatistics: TURN_STATISTICS,
      timingTokensPerSecond: 16.3,
    }),
    19.8,
  );
});

test("falls back to message timing throughput for legacy messages", () => {
  assert.equal(messageTokensPerSecond({ timingTokensPerSecond: 16.3 }), 16.3);
});

test("omits throughput when the turn has no measured LLM duration", () => {
  assert.equal(
    messageTokensPerSecond({
      turnStatistics: { ...TURN_STATISTICS, llmDurationMs: 0 },
      timingTokensPerSecond: 16.3,
    }),
    undefined,
  );
});
