import assert from "node:assert/strict";
import test from "node:test";

import { displayedAgentRunElapsedMs } from "./workbench-thread-timing";

test("advances only from the server elapsed baseline with a monotonic clock", () => {
  const timing = { startedAt: 12_345, elapsedMs: 2_500, observedAt: 80 };
  assert.equal(displayedAgentRunElapsedMs(timing, 580), 3_000);
  assert.equal(displayedAgentRunElapsedMs(timing, 40), 2_500);
});
