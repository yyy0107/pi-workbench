import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowMessagePerformance } from "./message-performance-visibility";

test("hides partial metrics for the latest response while it is running", () => {
  assert.equal(shouldShowMessagePerformance({ isLast: true, isRunning: true }), false);
});

test("shows metrics after the latest response completes", () => {
  assert.equal(shouldShowMessagePerformance({ isLast: true, isRunning: false }), true);
});

test("keeps completed historical metrics visible while a later response is running", () => {
  assert.equal(shouldShowMessagePerformance({ isLast: false, isRunning: true }), true);
});
