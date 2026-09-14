import assert from "node:assert/strict";
import test from "node:test";

import {
  consecutiveAttachmentIndices,
  defaultMessageDisclosureOpen,
  messageAttachmentReference,
  messageAttachmentVisualKind,
  messageTextPresentation,
  visibleMessageBlocks,
  type MessagePresentationDisclosure,
  type MessagePresentationPhase,
} from "../lib/message-presentation-policy";

test("hides only reasoning in presentation without mutating message history", () => {
  const blocks = [
    { kind: "reasoning", key: "thought", text: "Thinking" },
    { kind: "text", key: "answer", text: "Answer" },
  ] as const;
  assert.equal(visibleMessageBlocks(blocks, true), blocks);
  assert.deepEqual(visibleMessageBlocks(blocks, false), [blocks[1]]);
  assert.equal(blocks.length, 2);
});

test("the todo preference hides only its recorded tool cards", () => {
  const todo = {
    kind: "tool-call",
    key: "todo",
    callId: "todo",
    toolName: "workbench_todo",
    argumentsText: "{}",
    status: "complete",
  } as const;
  const text = { kind: "text", key: "answer", text: "Answer" } as const;
  const rpiv = { ...todo, key: "rpiv", toolName: "todo" };
  const other = { ...todo, key: "other", toolName: "another_todo_tool" };
  assert.deepEqual(visibleMessageBlocks([todo, rpiv, other, text], true, false), [other, text]);
});

const kinds: readonly MessagePresentationDisclosure[] = [
  "completed-turn",
  "steps",
  "reasoning",
  "tool",
  "parallel-tools",
  "file-changes",
];

function disclosureDefaults(phase: MessagePresentationPhase) {
  return Object.fromEntries(kinds.map((kind) => [kind, defaultMessageDisclosureOpen(kind, phase)]));
}

test("keeps the steps summary collapsed by default while a response is streaming", () => {
  assert.deepEqual(disclosureDefaults("streaming"), {
    "completed-turn": false,
    steps: false,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
    "file-changes": false,
  });
});

test("keeps only the steps summary open for a segment interrupted by steering", () => {
  assert.deepEqual(disclosureDefaults("steered"), {
    "completed-turn": false,
    steps: true,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
    "file-changes": false,
  });
});

test("closes every disclosure after the response completes", () => {
  assert.deepEqual(disclosureDefaults("completed"), {
    "completed-turn": false,
    steps: false,
    reasoning: false,
    tool: false,
    "parallel-tools": false,
    "file-changes": false,
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

test("groups consecutive file attachments without crossing other message parts", () => {
  const parts = [
    { kind: "text" },
    { kind: "file", mediaType: "image/png" },
    { kind: "file", mediaType: "application/pdf" },
    { kind: "file", mediaType: "text/plain" },
    { kind: "text" },
    { kind: "file", mediaType: "image/gif" },
    { kind: "file", mediaType: "application/zip" },
  ];

  assert.deepEqual(consecutiveAttachmentIndices(parts, 0), []);
  assert.deepEqual(consecutiveAttachmentIndices(parts, 1), [1, 2, 3]);
  assert.deepEqual(consecutiveAttachmentIndices(parts, 1, 2), [1]);
  assert.deepEqual(consecutiveAttachmentIndices(parts, 4), []);
  assert.deepEqual(consecutiveAttachmentIndices(parts, 5), [5, 6]);
  assert.equal(messageAttachmentVisualKind(parts[1]), "image");
  assert.equal(messageAttachmentVisualKind(parts[2]), "file");
});
