import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultMessageDisclosureOpen,
  messageAttachmentReference,
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

test("keeps only the steps summary open for a segment interrupted by steering", () => {
  assert.deepEqual(disclosureDefaults("steered"), {
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

test("numbers image and PDF references independently in message order", () => {
  const parts = [
    { kind: "text" },
    { kind: "file", mediaType: "image/png" },
    { kind: "file", mediaType: "application/pdf" },
    { kind: "file", mediaType: "image/jpeg" },
    { kind: "file", mediaType: "text/plain" },
    { kind: "file", mediaType: "application/pdf" },
  ];

  assert.equal(messageAttachmentReference(parts, 0), undefined);
  assert.deepEqual(messageAttachmentReference(parts, 1), { kind: "image", sequence: 1 });
  assert.deepEqual(messageAttachmentReference(parts, 2), { kind: "pdf", sequence: 1 });
  assert.deepEqual(messageAttachmentReference(parts, 3), { kind: "image", sequence: 2 });
  assert.equal(messageAttachmentReference(parts, 4), undefined);
  assert.deepEqual(messageAttachmentReference(parts, 5), { kind: "pdf", sequence: 2 });
  assert.equal(messageAttachmentReference(parts, 99), undefined);
});
