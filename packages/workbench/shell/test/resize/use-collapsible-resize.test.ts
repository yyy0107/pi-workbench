import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCollapsibleResizePreview,
  resolveCollapsibleResizeThreshold,
} from "../../src/resize/use-collapsible-resize";

test("caps the default collapse distance at the sidebar distance for wider panels", () => {
  assert.equal(resolveCollapsibleResizeThreshold(240), 120);
  assert.equal(resolveCollapsibleResizeThreshold(220), 110);
  assert.equal(resolveCollapsibleResizeThreshold(360), 240);
  assert.equal(resolveCollapsibleResizeThreshold(720), 600);
  assert.equal(resolveCollapsibleResizeThreshold(0), 0);
});

test("bounds custom collapse ratios", () => {
  assert.equal(resolveCollapsibleResizeThreshold(240, 0.75), 60);
  assert.equal(resolveCollapsibleResizeThreshold(240, -1), 240);
  assert.equal(resolveCollapsibleResizeThreshold(240, 2), 0);
});

test("keeps sidebar content at its minimum width while the layout collapses", () => {
  assert.deepEqual(resolveCollapsibleResizePreview(80, 240, 1), {
    layoutWidth: 80,
    contentWidth: 240,
    translateX: -160,
  });
  assert.deepEqual(resolveCollapsibleResizePreview(80, 360, -1), {
    layoutWidth: 80,
    contentWidth: 360,
    translateX: 280,
  });
});

test("keeps resize previews aligned once they are wider than the minimum", () => {
  assert.deepEqual(resolveCollapsibleResizePreview(420, 240, 1), {
    layoutWidth: 420,
    contentWidth: 420,
    translateX: 0,
  });
});
