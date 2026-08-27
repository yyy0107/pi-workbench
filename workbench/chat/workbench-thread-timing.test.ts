import assert from "node:assert/strict";
import test from "node:test";

import {
  agentAutoRetryStatus,
  agentRunTiming,
  displayedAgentRunElapsedMs,
} from "./workbench-thread-timing";

test("reads a server-authoritative agent run timing snapshot", () => {
  const timing = { startedAt: 12_345, elapsedMs: 2_500, observedAt: 80 };
  assert.equal(agentRunTiming({ agentRun: { timing } }), timing);
  assert.equal(
    agentRunTiming({ agentRun: { timing: { ...timing, elapsedMs: Number.NaN } } }),
    undefined,
  );
  assert.equal(agentRunTiming({ agentRun: {} }), undefined);
});

test("advances only from the server elapsed baseline with a monotonic clock", () => {
  const timing = { startedAt: 12_345, elapsedMs: 2_500, observedAt: 80 };
  assert.equal(displayedAgentRunElapsedMs(timing, 580), 3_000);
  assert.equal(displayedAgentRunElapsedMs(timing, 40), 2_500);
});

test("reads only valid automatic-retry state from agent runtime extras", () => {
  const retry = { attempt: 2, maxAttempts: 3 };
  assert.equal(agentAutoRetryStatus({ agentRun: { autoRetry: retry } }), retry);
  assert.equal(
    agentAutoRetryStatus({ agentRun: { autoRetry: { attempt: 0, maxAttempts: 3 } } }),
    undefined,
  );
  assert.equal(
    agentAutoRetryStatus({ agentRun: { autoRetry: { attempt: 4, maxAttempts: 3 } } }),
    undefined,
  );
  assert.equal(agentAutoRetryStatus({ agentRun: {} }), undefined);
});
