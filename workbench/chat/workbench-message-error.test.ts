import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowMessageError } from "./workbench-message-error";

test("hides failed attempts until the Pi run settles", () => {
  assert.equal(
    shouldShowMessageError({
      isRunning: true,
      terminationKind: "network-error",
    }),
    false,
  );
  assert.equal(
    shouldShowMessageError({
      isRunning: false,
      terminationKind: "network-error",
    }),
    true,
  );
});

test("does not show a terminal card for a completed termination", () => {
  assert.equal(
    shouldShowMessageError({
      isRunning: false,
      terminationKind: "completed",
    }),
    false,
  );
});
