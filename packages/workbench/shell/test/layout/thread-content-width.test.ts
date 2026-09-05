import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveExpandedThreadWidth,
  resolveThreadResponsiveLayout,
  THREAD_CONTENT_MIN_WIDTH_PX,
  THREAD_INDEX_HIDE_WIDTH_PX,
  THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX,
} from "../../src/layout/thread-content-width";

test("allows a compact conversation alongside the expanded sidebar", () => {
  assert.equal(THREAD_CONTENT_MIN_WIDTH_PX, 320);
});

test("hides the conversation index at the wide-gutter boundary", () => {
  assert.equal(THREAD_INDEX_HIDE_WIDTH_PX, 960);
  assert.deepEqual(resolveThreadResponsiveLayout(THREAD_INDEX_HIDE_WIDTH_PX + 1), {
    conversationIndexHidden: false,
    sidebarAutoCollapsed: false,
  });
  assert.deepEqual(resolveThreadResponsiveLayout(THREAD_INDEX_HIDE_WIDTH_PX), {
    conversationIndexHidden: true,
    sidebarAutoCollapsed: false,
  });
});

test("collapses the sidebar only after the compact conversation reaches its threshold", () => {
  assert.equal(THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX, 340);
  assert.deepEqual(resolveThreadResponsiveLayout(THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX + 1), {
    conversationIndexHidden: true,
    sidebarAutoCollapsed: false,
  });
  assert.deepEqual(resolveThreadResponsiveLayout(THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX), {
    conversationIndexHidden: true,
    sidebarAutoCollapsed: true,
  });
});

test("measures responsive stages against the width with the sidebar expanded", () => {
  assert.equal(
    resolveExpandedThreadWidth({
      currentThreadWidth: 608,
      sidebarWidth: 268,
      sidebarOccupiedWidth: 0,
    }),
    340,
  );
  assert.equal(
    resolveExpandedThreadWidth({
      currentThreadWidth: 340,
      sidebarWidth: 268,
      sidebarOccupiedWidth: 268,
    }),
    340,
  );
  assert.equal(
    resolveExpandedThreadWidth({
      currentThreadWidth: 474,
      sidebarWidth: 268,
      sidebarOccupiedWidth: 134,
    }),
    340,
  );
});

test("keeps index visibility stable throughout workspace opening and closing", () => {
  for (const workspaceWidth of [0, 360]) {
    for (const workspaceOccupiedWidth of [0, 72, 180, 300, 360]) {
      const expandedThreadWidth = resolveExpandedThreadWidth({
        currentThreadWidth: 1012 - workspaceOccupiedWidth,
        sidebarWidth: 268,
        sidebarOccupiedWidth: 268,
        workspaceWidth,
        workspaceOccupiedWidth,
      });

      assert.equal(expandedThreadWidth, 1012 - workspaceWidth);
      assert.equal(
        resolveThreadResponsiveLayout(expandedThreadWidth!)?.conversationIndexHidden,
        workspaceWidth > 0,
      );
    }
  }
});

test("rejects invalid responsive measurements", () => {
  assert.equal(resolveThreadResponsiveLayout(Number.NaN), undefined);
  assert.equal(
    resolveExpandedThreadWidth({
      currentThreadWidth: Number.NaN,
      sidebarWidth: 268,
      sidebarOccupiedWidth: 268,
    }),
    undefined,
  );
});
