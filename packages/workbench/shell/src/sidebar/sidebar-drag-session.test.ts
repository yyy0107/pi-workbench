import assert from "node:assert/strict";
import test from "node:test";

import { createSidebarDragSession } from "../hooks/use-sidebar-pointer-reorder";

test("sidebar drag click suppression is isolated per Shell installation", () => {
  const first = createSidebarDragSession();
  const second = createSidebarDragSession();

  first.suppressClicksUntil(350);
  assert.equal(first.isClickSuppressed(100), true);
  assert.equal(second.isClickSuppressed(100), false);
  assert.equal(first.isClickSuppressed(351), false);
});

test("persistence is serialized within a sidebar without blocking another installation", async () => {
  const first = createSidebarDragSession();
  const second = createSidebarDragSession();
  let finish!: () => void;
  const pending = first.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(first.getSnapshot().pending, true);
  let duplicateRan = false;
  await first.run(async () => {
    duplicateRan = true;
  });
  assert.equal(duplicateRan, false);
  let otherRan = false;
  await second.run(async () => {
    otherRan = true;
  });
  assert.equal(otherRan, true);
  finish();
  await pending;
  assert.equal(first.getSnapshot().pending, false);
  await assert.rejects(
    first.run(async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  assert.equal(first.getSnapshot().pending, false);
});
