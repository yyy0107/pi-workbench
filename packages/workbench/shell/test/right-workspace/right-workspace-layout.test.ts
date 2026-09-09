import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH,
  resolveRightWorkspacePresentation,
  resolveRightWorkspaceMaximumWidth,
  shouldCollapseRightWorkspaceBeforeSidebar,
} from "../../src/right-workspace/right-workspace-layout";
import {
  resolveExpandedThreadWidth,
  resolveThreadResponsiveLayout,
} from "../../src/layout/thread-content-width";

test("dragging the adjacent workspace reaches both responsive stages without resizing the page", () => {
  const availableWidth = 1400;
  const sidebarWidth = 268;
  const maximum = resolveRightWorkspaceMaximumWidth(availableWidth);
  assert.equal(maximum, 1080);
  for (const [workspaceWidth, indexHidden, sidebarCollapsed] of [
    [360, false, false],
    [440, true, false],
    [1059, true, false],
    [1060, true, true],
    [maximum, true, true],
    [360, false, false],
  ] as const) {
    // Releasing the sidebar's space must not immediately reopen it at the same divider position.
    for (const sidebarOccupiedWidth of [sidebarWidth, 134, 0]) {
      const width = resolveExpandedThreadWidth({
        currentThreadWidth: availableWidth + sidebarWidth - sidebarOccupiedWidth - workspaceWidth,
        sidebarWidth,
        sidebarOccupiedWidth,
        workspaceWidth,
        workspaceOccupiedWidth: workspaceWidth,
      });
      assert.deepEqual(resolveThreadResponsiveLayout(width!), {
        conversationIndexHidden: indexHidden,
        sidebarAutoCollapsed: sidebarCollapsed,
      });
    }
  }
});

test("keeps an opened right workspace in an occupying panel until it is explicitly maximized", () => {
  assert.equal(resolveRightWorkspacePresentation(false, false), "closed");
  assert.equal(resolveRightWorkspacePresentation(true, false), "panel");
  assert.equal(resolveRightWorkspacePresentation(true, true), "maximized");
});

test("keeps a closed maximized workspace out of the conversation layout", () => {
  assert.equal(resolveRightWorkspacePresentation(false, true), "closed");
});

test("collapses the right workspace first when a shrinking layout cannot preserve both panes", () => {
  assert.equal(
    shouldCollapseRightWorkspaceBeforeSidebar(
      "panel",
      MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH,
      MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH - 1,
    ),
    true,
  );
  assert.equal(
    shouldCollapseRightWorkspaceBeforeSidebar(
      "panel",
      MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH - 1,
      MIN_DOCKED_RIGHT_WORKSPACE_HOST_WIDTH,
    ),
    false,
  );
});

test("does not override an explicit narrow-layout open or a maximized workspace", () => {
  assert.equal(shouldCollapseRightWorkspaceBeforeSidebar("panel", 800, 800), false);
  assert.equal(shouldCollapseRightWorkspaceBeforeSidebar("maximized", 900, 800), false);
  assert.equal(shouldCollapseRightWorkspaceBeforeSidebar("closed", 900, 800), false);
});
