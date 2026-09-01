import assert from "node:assert/strict";
import test from "node:test";

import { workspaceTabScrollDelta } from "../../src/right-workspace/workspace-tab-layout";

test("does not scroll a fully visible workspace tab", () => {
  assert.equal(workspaceTabScrollDelta(100, 500, 180, 320), 0);
});

test("scrolls a workspace tab out from under the leading clip edge", () => {
  assert.equal(workspaceTabScrollDelta(100, 500, 72, 212), -28);
});

test("scrolls a workspace tab out from under the trailing header actions", () => {
  assert.equal(workspaceTabScrollDelta(100, 500, 440, 572), 72);
});
