import assert from "node:assert/strict";
import test from "node:test";

import { shouldMountWorkspaceSurface } from "./surface-mount-policy";

test("the active surface mounts even while its definition is unavailable", () => {
  assert.equal(
    shouldMountWorkspaceSurface({
      available: false,
      hasActivated: false,
      isActive: true,
    }),
    true,
  );
});

test("keep-alive surfaces load only after their first activation", () => {
  assert.equal(
    shouldMountWorkspaceSurface({
      available: true,
      cachePolicy: "keep-alive",
      hasActivated: false,
      isActive: false,
    }),
    false,
  );
  assert.equal(
    shouldMountWorkspaceSurface({
      available: true,
      cachePolicy: "keep-alive",
      hasActivated: true,
      isActive: false,
    }),
    true,
  );
});

test("unmount surfaces do not remain mounted after activation", () => {
  assert.equal(
    shouldMountWorkspaceSurface({
      available: true,
      cachePolicy: "unmount",
      hasActivated: true,
      isActive: false,
    }),
    false,
  );
});
