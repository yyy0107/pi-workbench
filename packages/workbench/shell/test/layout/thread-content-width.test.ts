import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveExpandedThreadWidth,
  resolveThreadResponsiveLayout,
  THREAD_CONTENT_COMPACT_GUTTER_PX,
  THREAD_CONTENT_INDEX_RELEASE_WIDTH_PX,
  THREAD_CONTENT_INDEX_GUTTER_PX,
  THREAD_CONTENT_MIN_WIDTH_PX,
  THREAD_INDEX_HIDE_WIDTH_PX,
  THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX,
} from "../../src/layout/thread-content-width";

test("keeps the final minimum conversation width at 448 pixels", () => {
  assert.equal(THREAD_CONTENT_MIN_WIDTH_PX, 448);
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

test("expands the conversation as the hidden index releases its gutters", () => {
  const widthBeforeIndexHides = THREAD_INDEX_HIDE_WIDTH_PX - THREAD_CONTENT_INDEX_GUTTER_PX * 2;
  const widthAfterIndexHides = THREAD_INDEX_HIDE_WIDTH_PX - THREAD_CONTENT_COMPACT_GUTTER_PX * 2;

  assert.equal(widthBeforeIndexHides, THREAD_CONTENT_INDEX_RELEASE_WIDTH_PX);
  assert.equal(THREAD_CONTENT_COMPACT_GUTTER_PX, 10);
  assert.equal(widthAfterIndexHides, 940);
  assert.equal(widthAfterIndexHides - widthBeforeIndexHides, 108);
});

test("collapses the sidebar only after the compact conversation reaches its threshold", () => {
  assert.equal(THREAD_SIDEBAR_AUTO_COLLAPSE_WIDTH_PX, 468);
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
      currentThreadWidth: 736,
      sidebarWidth: 268,
      sidebarOccupiedWidth: 0,
    }),
    468,
  );
  assert.equal(
    resolveExpandedThreadWidth({
      currentThreadWidth: 468,
      sidebarWidth: 268,
      sidebarOccupiedWidth: 268,
    }),
    468,
  );
  assert.equal(
    resolveExpandedThreadWidth({
      currentThreadWidth: 602,
      sidebarWidth: 268,
      sidebarOccupiedWidth: 134,
    }),
    468,
  );
});

test("keeps the gutter target stable throughout workspace opening and closing", () => {
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
