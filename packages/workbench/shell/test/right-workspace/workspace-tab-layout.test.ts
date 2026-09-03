import assert from "node:assert/strict";
import test from "node:test";

import {
  workspaceTabDropPosition,
  workspaceTabScrollDelta,
} from "../../src/right-workspace/workspace-tab-layout";

test("does not scroll a fully visible workspace tab", () => {
  assert.equal(workspaceTabScrollDelta(100, 500, 180, 320), 0);
});

test("scrolls a workspace tab out from under the leading clip edge", () => {
  assert.equal(workspaceTabScrollDelta(100, 500, 72, 212), -28);
});

test("scrolls a workspace tab out from under the trailing header actions", () => {
  assert.equal(workspaceTabScrollDelta(100, 500, 440, 572), 72);
});

test("maps pointer position to a logical drop edge in LTR and RTL", () => {
  assert.equal(workspaceTabDropPosition(120, 100, 80, "ltr"), "before");
  assert.equal(workspaceTabDropPosition(160, 100, 80, "ltr"), "after");
  assert.equal(workspaceTabDropPosition(120, 100, 80, "rtl"), "after");
  assert.equal(workspaceTabDropPosition(160, 100, 80, "rtl"), "before");
});
