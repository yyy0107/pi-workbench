import assert from "node:assert/strict";
import test from "node:test";

import { nextWorkspaceTabIndex, workspaceTabId, workspaceTabPanelId } from "./workspace-tab-a11y";

test("workspace tab ids remain paired for arbitrary surface ids", () => {
  assert.equal(workspaceTabId("file:/src/a.ts"), "right-workspace-tab-file%3A%2Fsrc%2Fa.ts");
  assert.equal(
    workspaceTabPanelId("file:/src/a.ts"),
    "right-workspace-tabpanel-file%3A%2Fsrc%2Fa.ts",
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
