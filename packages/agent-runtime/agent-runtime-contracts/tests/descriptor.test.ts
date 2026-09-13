import assert from "node:assert/strict";
import test from "node:test";

import { defineWorkbenchAgentRuntimeDescriptor } from "../src/descriptor";

test("defines a frozen Runtime descriptor while preserving its literal id", () => {
  const descriptor = defineWorkbenchAgentRuntimeDescriptor("fixture-runtime");

  assert.equal(descriptor.id, "fixture-runtime");
  assert.equal(Object.isFrozen(descriptor), true);
});

test("rejects empty or whitespace-padded Runtime ids", () => {
  assert.throws(() => defineWorkbenchAgentRuntimeDescriptor(""));
  assert.throws(() => defineWorkbenchAgentRuntimeDescriptor(" pi"));
  assert.throws(() => defineWorkbenchAgentRuntimeDescriptor("pi "));
});
