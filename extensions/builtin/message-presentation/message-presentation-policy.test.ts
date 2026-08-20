import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultMessageDisclosureOpen,
  messageTextPresentation,
  type MessagePresentationDisclosure,
  type MessagePresentationPhase,
} from "./message-presentation-policy";

const kinds: readonly MessagePresentationDisclosure[] = [
  "completed-turn",
  "steps",
  "reasoning",
  "tool",
  "parallel-tools",
];

function disclosureDefaults(phase: MessagePresentationPhase) {
  return Object.fromEntries(kinds.map((kind) => [kind, defaultMessageDisclosureOpen(kind, phase)]));
}

test("opens only the steps summary while a response is streaming", () => {
  assert.deepEqual(disclosureDefaults("streaming"), {
    "completed-turn": false,
    steps: true,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
  });
});

test("closes every disclosure after the response completes", () => {
  assert.deepEqual(disclosureDefaults("completed"), {
    "completed-turn": false,
    steps: false,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
  });
});

test("renders user text through the shared Composer document presentation", () => {
  assert.equal(messageTextPresentation("user"), "composer");
  assert.equal(messageTextPresentation("assistant"), "markdown");
  assert.equal(messageTextPresentation("system"), "markdown");
});
