import assert from "node:assert/strict";
import test from "node:test";

import { shouldMountWorkspaceSurface } from "../../src/right-workspace/surface-mount-policy";

const hiddenSurface = {
  available: true,
  dirty: false,
  hasActivated: true,
  isVisible: false,
} as const;

test("the visible surface mounts even while its definition is unavailable", () => {
  assert.equal(
    shouldMountWorkspaceSurface({
      available: false,
      dirty: false,
      hasActivated: false,
      isVisible: true,
    }),
    true,
  );
});

test("a hidden unmount surface does not remain mounted after activation", () => {
  assert.equal(
    shouldMountWorkspaceSurface({
      ...hiddenSurface,
      cachePolicy: "unmount",
    }),
    false,
  );
});

test("keep-alive surfaces load only after their first visible activation", () => {
  assert.equal(
    shouldMountWorkspaceSurface({
      ...hiddenSurface,
      cachePolicy: "keep-alive",
      hasActivated: false,
    }),
    false,
  );
  assert.equal(
    shouldMountWorkspaceSurface({
      ...hiddenSurface,
      cachePolicy: "keep-alive",
    }),
    true,
  );
});

test("preserve-dirty surfaces retain only unsaved content", () => {
  assert.equal(
    shouldMountWorkspaceSurface({
      ...hiddenSurface,
      cachePolicy: "preserve-dirty",
    }),
    false,
  );
  assert.equal(
    shouldMountWorkspaceSurface({
      ...hiddenSurface,
      cachePolicy: "preserve-dirty",
      dirty: true,
    }),
    true,
  );
  assert.equal(
    shouldMountWorkspaceSurface({
      ...hiddenSurface,
      cachePolicy: "preserve-dirty",
      dirty: true,
      hasActivated: false,
    }),
    true,
  );
});
