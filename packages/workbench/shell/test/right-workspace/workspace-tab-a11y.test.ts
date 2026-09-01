import assert from "node:assert/strict";
import test from "node:test";

import {
  nextWorkspaceTabIndex,
  workspaceTabId,
  workspaceTabPanelId,
} from "../../src/right-workspace/workspace-tab-a11y";

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

test("workspace tab arrow navigation wraps and respects text direction", () => {
  assert.equal(nextWorkspaceTabIndex("ArrowRight", 2, 3, "ltr"), 0);
  assert.equal(nextWorkspaceTabIndex("ArrowLeft", 0, 3, "ltr"), 2);
  assert.equal(nextWorkspaceTabIndex("ArrowRight", 0, 3, "rtl"), 2);
  assert.equal(nextWorkspaceTabIndex("ArrowLeft", 2, 3, "rtl"), 0);
  assert.equal(nextWorkspaceTabIndex("Home", 2, 3, "ltr"), 0);
  assert.equal(nextWorkspaceTabIndex("End", 0, 3, "ltr"), 2);
  assert.equal(nextWorkspaceTabIndex("Enter", 0, 3, "ltr"), undefined);
});
