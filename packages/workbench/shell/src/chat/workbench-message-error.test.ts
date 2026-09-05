import assert from "node:assert/strict";
import test from "node:test";

import { isLastAssistantInTurn } from "./message-action-visibility";
import { isMessageInLatestTurn, shouldShowMessageError } from "./workbench-message-error";

test("hides failed attempts until the Pi run settles", () => {
  assert.equal(
    shouldShowMessageError({
      isRunning: true,
      isInLatestTurn: true,
      isLastAssistantInTurn: true,
      terminationKind: "network-error",
    }),
    false,
  );
  assert.equal(
    shouldShowMessageError({
      isRunning: false,
      isInLatestTurn: true,
      isLastAssistantInTurn: true,
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
      isLastAssistantInTurn: true,
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
      isLastAssistantInTurn: true,
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

test("only the latest stopped attempt shows a card after repeated continuation", () => {
  const messages: { role: "user" | "assistant" | "system"; terminationKind?: string }[] = [
    { role: "user" },
  ];
  const visibleCards = (entries = messages, isRunning = false) =>
    entries.flatMap((message, index) =>
      message.role === "assistant" &&
      shouldShowMessageError({
        isRunning,
        isInLatestTurn: isMessageInLatestTurn(entries, index),
        isLastAssistantInTurn: isLastAssistantInTurn(entries, index),
        terminationKind: message.terminationKind,
      })
        ? [index]
        : [],
    );

  for (const terminationKind of ["cancelled", "cancelled", "aborted"]) {
    messages.push({ role: "assistant", terminationKind });
    const stoppedIndex = messages.length - 1;
    messages.push({ role: "system" });
    assert.deepEqual(visibleCards(), [stoppedIndex]);
    assert.deepEqual(visibleCards(structuredClone(messages)), [stoppedIndex]);
    assert.deepEqual(visibleCards(messages, true), []);
  }

  messages.push({ role: "assistant", terminationKind: "completed" });
  assert.deepEqual(visibleCards(), []);
  assert.deepEqual(visibleCards(structuredClone(messages)), []);
});

test("retains the final stopped card of an earlier user turn as history", () => {
  const messages = [
    { role: "user" as const },
    { role: "assistant" as const },
    { role: "system" as const },
    { role: "user" as const },
    { role: "assistant" as const },
  ];

  assert.equal(isMessageInLatestTurn(messages, 1), false);
  assert.equal(isLastAssistantInTurn(messages, 1), true);
  assert.equal(
    shouldShowMessageError({
      isRunning: true,
      isInLatestTurn: isMessageInLatestTurn(messages, 1),
      isLastAssistantInTurn: isLastAssistantInTurn(messages, 1),
      terminationKind: "cancelled",
    }),
    true,
  );
});
