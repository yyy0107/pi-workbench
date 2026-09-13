import assert from "node:assert/strict";
import test from "node:test";

import { workbenchBashInputFromArgs } from "../src/bash-tool-input";

test("reads agent-owned and user-owned bash input from streamed tool arguments", () => {
  assert.deepEqual(workbenchBashInputFromArgs({ input: { source: "agent", data: "yes\n" } }), {
    source: "agent",
    data: "yes\n",
  });
  assert.deepEqual(workbenchBashInputFromArgs({ input: { source: "user" } }), {
    source: "user",
  });
});

test("ignores incomplete or invalid bash input arguments", () => {
  assert.equal(workbenchBashInputFromArgs(undefined), undefined);
  assert.equal(workbenchBashInputFromArgs({ input: { source: "agent" } }), undefined);
  assert.equal(workbenchBashInputFromArgs({ input: { source: "other" } }), undefined);
});
