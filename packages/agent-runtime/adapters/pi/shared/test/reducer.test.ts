import assert from "node:assert/strict";
import test from "node:test";

import { applySessionMessageDelta, copyPiAssistantMessage } from "../src/messages/reducer";

test("applies interleaved text and thinking deltas immutably by content index", () => {
  const initial = {
    role: "assistant" as const,
    content: [
      { type: "text" as const, text: "A" },
      { type: "thinking" as const, thinking: "B" },
    ],
  };
  const updated = applySessionMessageDelta(initial, new Map(), {
    type: "thinking_delta",
    contentIndex: 1,
    delta: "C",
  });

  assert.deepEqual(updated?.content, [
    { type: "text", text: "A" },
    { type: "thinking", thinking: "BC" },
  ]);
  assert.deepEqual(initial.content, [
    { type: "text", text: "A" },
    { type: "thinking", thinking: "B" },
  ]);
});

test("retains raw partial tool JSON until the completed tool call arrives", () => {
  const buffers = new Map<number, string>();
  const started = applySessionMessageDelta({ role: "assistant", content: [] }, buffers, {
    type: "toolcall_start",
    contentIndex: 0,
    id: "tool-1",
    toolName: "search",
  });
  assert.ok(started);
  const partial = applySessionMessageDelta(started, buffers, {
    type: "toolcall_delta",
    contentIndex: 0,
    delta: '{"query":"hel',
  });
  assert.deepEqual(partial?.content[0], {
    type: "toolCall",
    id: "tool-1",
    name: "search",
    arguments: { query: "hel" },
  });
  assert.equal(buffers.get(0), '{"query":"hel');

  const completed = applySessionMessageDelta(partial!, buffers, {
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: { type: "toolCall", id: "tool-1", name: "search", arguments: { query: "hello" } },
  });
  assert.deepEqual(completed?.content[0], {
    type: "toolCall",
    id: "tool-1",
    name: "search",
    arguments: { query: "hello" },
  });
  assert.equal(buffers.has(0), false);
});

test("copies mutable nested message fields", () => {
  const source = {
    role: "assistant" as const,
    content: [{ type: "toolCall" as const, id: "tool-1", name: "search", arguments: { q: 1 } }],
    usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10 },
    diagnostics: [{ type: "example", timestamp: 1, details: { stable: true } }],
  };
  const copy = copyPiAssistantMessage(source);

  assert.notStrictEqual(copy, source);
  assert.notStrictEqual(copy.content, source.content);
  assert.notStrictEqual(copy.content[0], source.content[0]);
  assert.notStrictEqual(copy.usage, source.usage);
  assert.notStrictEqual(copy.diagnostics, source.diagnostics);
});
