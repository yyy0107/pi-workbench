import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUXILIARY_SURFACE_WIDTH,
  MIN_AUXILIARY_SURFACE_WIDTH,
  MIN_HORIZONTAL_SPLIT_WIDTH,
  auxiliarySurfaceSnapPoints,
  clampAuxiliarySurfaceWidth,
  resolveWorkspaceSplitLayout,
} from "./workspace-split-layout";

test("keeps a single pane when no auxiliary surface is active", () => {
  assert.deepEqual(resolveWorkspaceSplitLayout(900, 380, false), {
    mode: "single",
    auxiliaryWidth: 0,
    maximumAuxiliaryWidth: 0,
  });
});

test("resolves a bounded horizontal split on ordinary workspace widths", () => {
  assert.deepEqual(resolveWorkspaceSplitLayout(900, 420, true), {
    mode: "horizontal",
    auxiliaryWidth: 420,
    maximumAuxiliaryWidth: 680,
  });
  assert.equal(resolveWorkspaceSplitLayout(500, 900, true).auxiliaryWidth, 280);
  assert.equal(
    resolveWorkspaceSplitLayout(900, 20, true).auxiliaryWidth,
    MIN_AUXILIARY_SURFACE_WIDTH,
  );
});

test("stacks both panes when the inspector cannot preserve usable columns", () => {
  assert.deepEqual(resolveWorkspaceSplitLayout(MIN_HORIZONTAL_SPLIT_WIDTH - 1, 320, true), {
    mode: "stacked",
    auxiliaryWidth: MIN_HORIZONTAL_SPLIT_WIDTH - 1,
    maximumAuxiliaryWidth: MIN_HORIZONTAL_SPLIT_WIDTH - 1,
  });
});

test("normalizes invalid persisted auxiliary widths", () => {
  assert.equal(clampAuxiliarySurfaceWidth(Number.NaN), DEFAULT_AUXILIARY_SURFACE_WIDTH);
  assert.equal(clampAuxiliarySurfaceWidth(10), MIN_AUXILIARY_SURFACE_WIDTH);
  assert.equal(clampAuxiliarySurfaceWidth(333.6), 334);
});

test("provides bounded normal and wide magnetic snap points", () => {
  assert.deepEqual(auxiliarySurfaceSnapPoints(680), [420, 560]);
  assert.deepEqual(auxiliarySurfaceSnapPoints(500), [420, 500]);
  assert.deepEqual(auxiliarySurfaceSnapPoints(460), [420]);
  assert.deepEqual(auxiliarySurfaceSnapPoints(280), [280]);
});
