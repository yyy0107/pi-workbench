import assert from "node:assert/strict";
import test from "node:test";

import { workspaceTabId, workspaceTabPanelId } from "../../src/right-workspace/workspace-tab-a11y";

test("workspace tab ids remain paired for arbitrary surface ids", () => {
  assert.equal(
    workspaceTabId(":first:-right-workspace-tab", "file:/src/a.ts"),
    ":first:-right-workspace-tab-file%3A%2Fsrc%2Fa.ts",
  );
  assert.equal(
    workspaceTabPanelId(":first:-right-workspace-tabpanel", "file:/src/a.ts"),
    ":first:-right-workspace-tabpanel-file%3A%2Fsrc%2Fa.ts",
  );
  assert.notEqual(
    workspaceTabId(":first:-right-workspace-tab", "shared"),
    workspaceTabId(":second:-right-workspace-tab", "shared"),
  );
});
