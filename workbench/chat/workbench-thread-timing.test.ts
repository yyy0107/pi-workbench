import assert from "node:assert/strict";
import test from "node:test";

import { displayedPiRunElapsedMs, piAutoRetryStatus, piRunTiming } from "./workbench-thread-timing";

test("reads a server-authoritative Pi run timing snapshot", () => {
  const timing = { startedAt: 12_345, elapsedMs: 2_500, observedAt: 80 };
  assert.equal(piRunTiming({ piRun: { timing } }), timing);
  assert.equal(piRunTiming({ piRun: { timing: { ...timing, elapsedMs: Number.NaN } } }), undefined);
  assert.equal(piRunTiming({ piRun: {} }), undefined);
});

test("advances only from the server elapsed baseline with a monotonic clock", () => {
  const timing = { startedAt: 12_345, elapsedMs: 2_500, observedAt: 80 };
  assert.equal(displayedPiRunElapsedMs(timing, 580), 3_000);
  assert.equal(displayedPiRunElapsedMs(timing, 40), 2_500);
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
