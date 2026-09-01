import assert from "node:assert/strict";
import test from "node:test";

import { createSidebarDragSession } from "./sidebar-drag-session";

test("sidebar drag click suppression is isolated per Shell installation", () => {
  const first = createSidebarDragSession();
  const second = createSidebarDragSession();

  first.suppressClicksUntil(350);
  assert.equal(first.isClickSuppressed(100), true);
  assert.equal(second.isClickSuppressed(100), false);
  assert.equal(first.isClickSuppressed(351), false);
});
