import assert from "node:assert/strict";
import test from "node:test";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "../src/descriptor";

test("publishes the stable Pi Runtime identity through the generic descriptor contract", () => {
  assert.deepEqual(PI_AGENT_RUNTIME_DESCRIPTOR, { id: "pi" });
  assert.equal(Object.isFrozen(PI_AGENT_RUNTIME_DESCRIPTOR), true);
});
