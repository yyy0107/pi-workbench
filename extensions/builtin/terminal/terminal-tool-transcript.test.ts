import assert from "node:assert/strict";
import test from "node:test";
import type { ThreadMessage } from "@assistant-ui/react";

import {
  bashCommandFromArgs,
  findBashToolCall,
  findBashToolCallMessage,
  terminalResultLines,
  terminalResultText,
} from "./terminal-tool-transcript";

test("finds the authoritative bash tool call by id", () => {
  const bashPart = {
    type: "tool-call",
    toolCallId: "call-2",
    toolName: "bash",
    args: { command: "pnpm test" },
    argsText: '{"command":"pnpm test"}',
    status: { type: "running" },
    artifact: "starting",
  };
  const messages = [
    {
      id: "message-1",
      role: "assistant",
      createdAt: new Date(0),
      status: { type: "running" },
      content: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "read",
          args: {},
          argsText: "{}",
          status: { type: "complete" },
        },
        bashPart,
      ],
      metadata: {},
    },
  ] as unknown as readonly ThreadMessage[];

  assert.equal(findBashToolCall(messages, "call-2"), bashPart);
  assert.equal(findBashToolCallMessage(messages, "call-2"), messages[0]);
  assert.equal(findBashToolCall(messages, "missing"), undefined);
});

test("normalizes command output for both terminal presentations", () => {
  assert.equal(bashCommandFromArgs({ command: "pwd" }), "pwd");
  assert.equal(bashCommandFromArgs({ command: 42 }), undefined);
  assert.equal(terminalResultText({ text: "one\r\ntwo" }), "one\r\ntwo");
  assert.deepEqual(terminalResultLines({ text: "one\r\ntwo" }), ["one", "two"]);
  assert.equal(terminalResultText({ ok: true }), '{\n  "ok": true\n}');
});
