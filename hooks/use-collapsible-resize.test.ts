import assert from "node:assert/strict";
import test from "node:test";

import { resolveCollapsibleResizeThreshold } from "./use-collapsible-resize";

test("derives the collapse threshold from the fixed minimum width", () => {
  assert.equal(resolveCollapsibleResizeThreshold(240), 120);
  assert.equal(resolveCollapsibleResizeThreshold(220), 110);
  assert.equal(resolveCollapsibleResizeThreshold(360), 180);
});

test("bounds custom collapse ratios", () => {
  assert.equal(resolveCollapsibleResizeThreshold(240, 0.75), 60);
  assert.equal(resolveCollapsibleResizeThreshold(240, -1), 240);
  assert.equal(resolveCollapsibleResizeThreshold(240, 2), 0);
});
