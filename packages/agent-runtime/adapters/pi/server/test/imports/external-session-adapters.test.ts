import assert from "node:assert/strict";
import test from "node:test";

import { parseClaudeCodeRecords } from "../../src/imports/claude-code-session-adapter";
import { parseCodexRecords } from "../../src/imports/codex-session-adapter";
import { parseCursorConversation } from "../../src/imports/cursor-session-adapter";
import { importedSessionId } from "../../src/imports/source-utils";

test("Codex records become Pi user, assistant, and paired tool messages", () => {
  const parsed = parseCodexRecords(
    [
      {
        type: "session_meta",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: {
          session_id: "codex-1",
          cwd: "/project",
          model_provider: "openai",
        },
      },
      {
        type: "turn_context",
        payload: { model: "gpt-5", cwd: "/project" },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:00:01.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fix the build" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:00:02.000Z",
        payload: {
          type: "custom_tool_call",
          call_id: "call-1",
          name: "shell",
          input: '{"command":"pnpm test"}',
        },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:00:03.000Z",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-1",
          output: [{ type: "input_text", text: "passed" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:00:04.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done" }],
        },
      },
    ],
    "fallback",
    0,
  );

  assert.equal(parsed.descriptor.sourceSessionId, "codex-1");
  assert.equal(parsed.descriptor.cwd, "/project");
  assert.equal(parsed.descriptor.title, "Fix the build");
  assert.deepEqual(
    parsed.messages.map((message) => message.role),
    ["user", "assistant", "toolResult", "assistant"],
  );
  const toolCallMessage = parsed.messages[1];
  assert.equal(toolCallMessage.role, "assistant");
  assert.deepEqual(toolCallMessage.content[0], {
    type: "toolCall",
    id: "call-1",
    name: "shell",
    arguments: { command: "pnpm test" },
  });
});

test("Codex ignores injected host context and titles attached requests from user text", () => {
  const userRequest = `
# Files mentioned by the user:

## screenshot.png: /tmp/screenshot.png

## My request:
修复导入标题
`;
  const parsed = parseCodexRecords(
    [
      {
        type: "session_meta",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: { session_id: "00000000-0000-0000-0000-000000000002", cwd: "/project" },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:00:01.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<recommended_plugins>hidden catalog</recommended_plugins>",
            },
            {
              type: "input_text",
              text: "# AGENTS.md instructions\n\n<INSTRUCTIONS>hidden</INSTRUCTIONS>",
            },
            {
              type: "input_text",
              text: "<environment_context>hidden cwd</environment_context>",
            },
          ],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:00:02.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: userRequest }],
        },
      },
      {
        type: "event_msg",
        timestamp: "2026-01-01T00:00:02.000Z",
        payload: { type: "user_message", message: userRequest },
      },
      {
        type: "response_item",
        timestamp: "2026-01-01T00:00:03.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "已修复" }],
        },
      },
    ],
    "00000000-0000-0000-0000-000000000001",
    0,
  );

  assert.equal(parsed.descriptor.sourceSessionId, "00000000-0000-0000-0000-000000000001");
  assert.equal(parsed.descriptor.title, "修复导入标题");
  assert.deepEqual(
    parsed.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  const userMessage = parsed.messages[0];
  assert.equal(userMessage.role, "user");
  assert.equal(userMessage.content, userRequest);
  assert.doesNotMatch(JSON.stringify(parsed.messages), /recommended_plugins|environment_context/u);
});

test("Claude Code parsing follows the selected UUID branch and preserves tool results", () => {
  const parsed = parseClaudeCodeRecords(
    [
      {
        type: "user",
        uuid: "user-root",
        parentUuid: null,
        sessionId: "claude-1",
        cwd: "/project",
        timestamp: "2026-01-02T00:00:00.000Z",
        message: { role: "user", content: "Inspect this" },
      },
      {
        type: "assistant",
        uuid: "assistant-tool",
        parentUuid: "user-root",
        sessionId: "claude-1",
        cwd: "/project",
        timestamp: "2026-01-02T00:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file: "a.ts" } }],
        },
      },
      {
        type: "user",
        uuid: "tool-result",
        parentUuid: "assistant-tool",
        sessionId: "claude-1",
        cwd: "/project",
        timestamp: "2026-01-02T00:00:02.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-1", content: "file body" }],
        },
      },
      {
        type: "assistant",
        uuid: "abandoned-branch",
        parentUuid: "user-root",
        sessionId: "claude-1",
        cwd: "/project",
        timestamp: "2026-01-02T00:00:03.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet",
          content: [{ type: "text", text: "skip" }],
        },
      },
      { type: "last-prompt", leafUuid: "tool-result", sessionId: "claude-1" },
    ],
    "fallback",
    0,
  );

  assert.equal(parsed.descriptor.title, "Inspect this");
  assert.deepEqual(
    parsed.messages.map((message) => message.role),
    ["user", "assistant", "toolResult"],
  );
  const toolResult = parsed.messages[2];
  assert.equal(toolResult.role, "toolResult");
  assert.equal(toolResult.toolName, "Read");
});

test("Claude Code subagents have identities distinct from their parent and siblings", () => {
  const record = {
    type: "user",
    uuid: "user-root",
    parentUuid: null,
    sessionId: "claude-parent",
    cwd: "/project",
    timestamp: "2026-01-02T00:00:00.000Z",
    message: { role: "user", content: "Inspect this" },
  };
  const parent = parseClaudeCodeRecords([record], "claude-parent", 0);
  const first = parseClaudeCodeRecords([{ ...record, agentId: "one" }], "agent-one", 0);
  const second = parseClaudeCodeRecords([{ ...record, agentId: "two" }], "agent-two", 0);

  assert.equal(parent.descriptor.sourceSessionId, "claude-parent");
  assert.equal(first.descriptor.sourceSessionId, "claude-parent:agent:one");
  assert.equal(second.descriptor.sourceSessionId, "claude-parent:agent:two");
  assert.notEqual(parent.descriptor.sourceSessionId, first.descriptor.sourceSessionId);
  assert.notEqual(first.descriptor.sourceSessionId, second.descriptor.sourceSessionId);
  assert.equal(parent.descriptor.subagent, undefined);
  assert.equal(first.descriptor.subagent, true);
  assert.equal(second.descriptor.subagent, true);
});

test("Cursor bubbles map user text, assistant text, and completed tool data", () => {
  const parsed = parseCursorConversation({
    composerId: "cursor-1",
    header: {
      name: "Refactor runtime",
      workspaceIdentifier: { uri: { fsPath: "/project" } },
    },
    composer: { modelConfig: { modelName: "cursor-large" } },
    bubbles: [
      { type: 1, bubbleId: "u1", text: "Please refactor", createdAt: "2026-01-03T00:00:00Z" },
      { type: 2, bubbleId: "a1", text: "Checking", createdAt: "2026-01-03T00:00:01Z" },
      {
        type: 2,
        bubbleId: "t1",
        text: "",
        createdAt: "2026-01-03T00:00:02Z",
        toolFormerData: {
          toolCallId: "cursor-tool-1",
          name: "grep",
          rawArgs: '{"query":"SessionManager"}',
          result: "one match",
          status: "completed",
        },
      },
    ],
    createdAt: Date.parse("2026-01-03T00:00:00Z"),
    updatedAt: Date.parse("2026-01-03T00:00:02Z"),
  });

  assert.equal(parsed.descriptor.cwd, "/project");
  assert.equal(parsed.descriptor.title, "Refactor runtime");
  assert.deepEqual(
    parsed.messages.map((message) => message.role),
    ["user", "assistant", "assistant", "toolResult"],
  );
});

test("external session ids are deterministic and source-scoped", () => {
  assert.equal(importedSessionId("codex", "same"), importedSessionId("codex", "same"));
  assert.notEqual(importedSessionId("codex", "same"), importedSessionId("cursor", "same"));
  assert.match(importedSessionId("claude-code", "id"), /^[A-Za-z0-9._-]+$/u);
});
