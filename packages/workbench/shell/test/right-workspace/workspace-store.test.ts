import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RIGHT_WORKSPACE_WIDTH,
  MIN_RIGHT_WORKSPACE_WIDTH,
  createRightWorkspaceStore,
} from "../../src/right-workspace/workspace-store";

test("right workspace defaults to its minimum width", () => {
  assert.equal(DEFAULT_RIGHT_WORKSPACE_WIDTH, MIN_RIGHT_WORKSPACE_WIDTH);
  assert.equal(createRightWorkspaceStore().getState().width, MIN_RIGHT_WORKSPACE_WIDTH);
});
