import assert from "node:assert/strict";
import test from "node:test";

import type { SessionContextTraceJsonValue } from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  groupContextTraceMessages,
  listContextTraceAttachments,
  listContextTraceMessages,
  listContextTraceOutputBlocks,
} from "./context-trace-messages";

test("groups captured context into system, user, assistant, and tool rows", () => {
  const groups = groupContextTraceMessages([
    { role: "system", content: "System rules" },
    { role: "custom", customType: "workbench.hidden", content: "internal" },
    { role: "user", content: [{ type: "text", text: "Run the check" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "I should inspect it" },
        { type: "toolCall", name: "bash", arguments: { command: "pwd" } },
      ],
    },
    {
      role: "toolResult",
      toolName: "bash",
      content: [{ type: "text", text: "/workspace" }],
      isError: false,
    },
    { role: "assistant", content: [{ type: "text", text: "Done" }] },
  ]);

  assert.deepEqual(
    Object.fromEntries(Object.entries(groups).map(([role, entries]) => [role, entries.length])),
    { system: 1, compaction: 0, user: 1, assistant: 2, tool: 2 },
  );
  assert.equal(groups.user[0]?.preview, "Run the check");
  assert.equal(groups.assistant[0]?.preview, "I should inspect it");
  assert.equal(groups.assistant[1]?.preview, "Done");
  assert.equal(groups.tool[0]?.toolName, "bash");
  assert.match(groups.tool[0]?.text ?? "", /"command": "pwd"/);
  assert.equal(groups.tool[1]?.toolName, "bash");
  assert.equal(groups.tool[1]?.preview, "/workspace");
});

test("omits unsupported bookkeeping roles and tolerates non-array captures", () => {
  assert.deepEqual(groupContextTraceMessages({ role: "user" }), {
    system: [],
    compaction: [],
    user: [],
    assistant: [],
    tool: [],
  });
  assert.deepEqual(groupContextTraceMessages([{ role: "custom", content: "hidden" }]), {
    system: [],
    compaction: [],
    user: [],
    assistant: [],
    tool: [],
  });
});

test("lists context messages in provider-visible order", () => {
  const entries = listContextTraceMessages(
    [
      { role: "compactionSummary", summary: "Earlier work was compacted", tokensBefore: 97_000 },
      { role: "user", content: "First" },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }],
      },
      { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "Done" }] },
      { role: "custom", content: "hidden" },
      { role: "user", content: "Last" },
    ],
    [7, 2, 3, 4, 999, 1],
  );

  assert.deepEqual(
    entries.map((entry) => [entry.sourceIndex, entry.role, entry.preview, entry.estimatedTokens]),
    [
      [0, "compaction", "Earlier work was compacted", 7],
      [1, "user", "First", 2],
      [2, "assistant", "tool_call: bash", 3],
      [3, "tool", "Done", 4],
      [5, "user", "Last", 1],
    ],
  );
});

test("keeps finalized assistant output blocks in source order", () => {
  const blocks = listContextTraceOutputBlocks({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Inspect first" },
      { type: "text", text: "I will check." },
      { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } },
    ],
  });

  assert.deepEqual(
    blocks.map((block) => [block.kind, block.toolName]),
    [
      ["reasoning", undefined],
      ["text", undefined],
      ["tool-call", "bash"],
    ],
  );
  assert.equal(blocks[2]?.toolCallId, "call-1");
  assert.match(blocks[2]?.text ?? "", /"command": "pwd"/);
});

test("keeps attachments with their user message and only previews safe inline images", () => {
  const message: SessionContextTraceJsonValue = {
    role: "user",
    content: [
      { type: "text", text: "Compare these files" },
      {
        type: "image",
        data: "iVBORw0KGgo=",
        mimeType: "image/png",
        name: "diagram.png",
      },
      {
        type: "file",
        data: "JVBERi0=",
        mimeType: "application/pdf",
        name: "notes.pdf",
      },
      {
        type: "image",
        data: "data:image/svg+xml;base64,PHN2Zz4=",
        mimeType: "image/svg+xml",
      },
    ],
  };

  const [entry] = listContextTraceMessages([message]);
  assert.equal(entry?.text, "Compare these files");
  assert.deepEqual(
    entry?.attachments.map(({ contentIndex, kind, mediaType, name, source }) => ({
      contentIndex,
      kind,
      mediaType,
      name,
      source,
    })),
    [
      {
        contentIndex: 1,
        kind: "image",
        mediaType: "image/png",
        name: "diagram.png",
        source: "data:image/png;base64,iVBORw0KGgo=",
      },
      {
        contentIndex: 2,
        kind: "file",
        mediaType: "application/pdf",
        name: "notes.pdf",
        source: undefined,
      },
      {
        contentIndex: 3,
        kind: "image",
        mediaType: "image/svg+xml",
        name: undefined,
        source: undefined,
      },
    ],
  );
  assert.equal(listContextTraceAttachments(message).length, 3);
});
