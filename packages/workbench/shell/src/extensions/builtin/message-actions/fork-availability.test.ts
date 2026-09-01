import assert from "node:assert/strict";
import test from "node:test";

import { assistantForkEventSequence, isExpectedForkUnavailableError } from "./fork-availability";

test("exposes every canonical message_end sequence for conversation forks", () => {
  assert.equal(assistantForkEventSequence(7), 7);
  assert.equal(assistantForkEventSequence(-1), undefined);
  assert.equal(assistantForkEventSequence(1.5), undefined);
  assert.equal(assistantForkEventSequence(undefined), undefined);
});

test("recognizes only the stable unavailable-boundary RPC error", () => {
  assert.equal(isExpectedForkUnavailableError({ code: "fork-unavailable" }), true);
  assert.equal(isExpectedForkUnavailableError({ code: "session-not-found" }), false);
  assert.equal(isExpectedForkUnavailableError(new Error("fork-unavailable")), false);
});
