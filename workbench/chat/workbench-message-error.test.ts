import assert from "node:assert/strict";
import test from "node:test";

import { isMessageInLatestTurn, shouldShowMessageError } from "./workbench-message-error";

test("hides failed attempts until the Pi run settles", () => {
  assert.equal(
    shouldShowMessageError({
      isRunning: true,
      isInLatestTurn: true,
      terminationKind: "network-error",
    }),
    false,
  );
  assert.equal(
    shouldShowMessageError({
      isRunning: false,
      isInLatestTurn: true,
      terminationKind: "network-error",
    }),
    true,
  );
});

test("keeps a historical failure visible while a later turn is running", () => {
  assert.equal(
    shouldShowMessageError({
      isRunning: true,
      isInLatestTurn: false,
      terminationKind: "network-error",
    }),
    true,
  );
});

test("does not show a terminal card for a completed termination", () => {
  assert.equal(
    shouldShowMessageError({
      isRunning: false,
      isInLatestTurn: false,
      terminationKind: "completed",
    }),
    false,
  );
});

test("identifies a message as historical only after a later user turn", () => {
  const messages = [
    { role: "user" as const },
    { role: "assistant" as const },
    { role: "system" as const },
    { role: "assistant" as const },
    { role: "user" as const },
    { role: "assistant" as const },
  ];

  assert.equal(isMessageInLatestTurn(messages, 1), false);
  assert.equal(isMessageInLatestTurn(messages, 3), false);
  assert.equal(isMessageInLatestTurn(messages, 5), true);
  assert.equal(isMessageInLatestTurn(messages, 99), false);
});
