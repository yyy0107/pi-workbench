import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";

import {
  bashCommandFromArgs,
  findBashToolCall,
  findBashToolCallMessage,
  terminalOutputAppendDelta,
  terminalResultLines,
  terminalResultText,
} from "./terminal-tool-transcript";

test("finds the authoritative bash tool call by id", () => {
  const bashBlock = {
    key: "tool:call-2",
    kind: "tool-call",
    callId: "call-2",
    toolName: "bash",
    arguments: { command: "pnpm test" },
    argumentsText: '{"command":"pnpm test"}',
    status: "running",
    result: "starting",
  } as const;
  const nodes = [
    {
      key: "message-1",
      kind: "assistant",
      createdAt: 0,
      status: "running",
      blocks: [
        {
          key: "tool:call-1",
          kind: "tool-call",
          callId: "call-1",
          toolName: "read",
          arguments: {},
          argumentsText: "{}",
          status: "complete",
        },
        bashBlock,
      ],
    },
  ] satisfies readonly ConversationNode[];

  assert.equal(findBashToolCall(nodes, "call-2"), bashBlock);
  assert.equal(findBashToolCallMessage(nodes, "call-2"), nodes[0]);
  assert.equal(findBashToolCall(nodes, "missing"), undefined);
});

test("normalizes command output for both terminal presentations", () => {
  assert.equal(bashCommandFromArgs({ command: "pwd" }), "pwd");
  assert.equal(bashCommandFromArgs({ command: 42 }), undefined);
  assert.equal(terminalResultText({ text: "one\r\ntwo" }), "one\r\ntwo");
  assert.deepEqual(terminalResultLines({ text: "one\r\ntwo" }), ["one", "two"]);
  assert.equal(terminalResultText({ ok: true }), '{\n  "ok": true\n}');
});

test("extracts only newly appended terminal output", () => {
  assert.equal(terminalOutputAppendDelta("first", "first\nsecond"), "\nsecond");
  assert.equal(terminalOutputAppendDelta("same", "same"), "");
  assert.equal(terminalOutputAppendDelta("old output", "replacement"), undefined);
});
