import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRemoteConversationPageV1,
  parseRemoteOperationRequestV1,
  parseRemoteOperationResultV1,
} from "../src/codecs.ts";

const issuedAt = "2030-09-13T20:00:00.000Z";
const expiresAt = "2030-09-13T20:01:00.000Z";

function operation(command: unknown) {
  return {
    type: "operation.request",
    operationId: "operation-1",
    issuedAt,
    expiresAt,
    command,
  };
}

function message(itemId: string) {
  return {
    type: "assistant-message",
    itemId,
    createdAt: issuedAt,
    text: `Message ${itemId}`,
    state: "complete",
  };
}

function page(items: readonly unknown[]) {
  return {
    sessionId: "session-1",
    items,
    historyCursor: "history-page-1",
    nextCursor: "history-page-2",
    sessionRevision: "session-revision-1",
    projectionCursor: { epoch: "epoch-1", offset: "42" },
  };
}

test("strictly parses the bounded mobile conversation item union", () => {
  const value = page([
    {
      type: "user-message",
      itemId: "message-user-1",
      createdAt: issuedAt,
      text: "Run the focused checks",
      state: "complete",
    },
    message("message-assistant-1"),
    {
      type: "assistant-message",
      itemId: "message-assistant-tools-1",
      createdAt: issuedAt,
      toolCalls: [
        {
          toolCallId: "tool-call-1",
          toolName: "read",
          arguments: '{"path":"README.md"}',
          truncated: false,
        },
      ],
      state: "complete",
    },
    {
      type: "tool-result",
      itemId: "tool-result-1",
      createdAt: issuedAt,
      toolCallId: "tool-call-1",
      toolName: "read",
      output: "Workbench documentation",
      isError: false,
      truncated: false,
    },
    {
      type: "activity-summary",
      itemId: "activity-1",
      createdAt: issuedAt,
      activity: "tool-completed",
      displayName: "Checked workspace",
      summary: "The focused checks completed.",
    },
    {
      type: "ordinary-question",
      interactionId: "interaction-1",
      sessionId: "session-1",
      revision: "interaction-revision-1",
      expiresAt,
      questions: [
        {
          questionId: "question-1",
          prompt: "Continue?",
          options: [{ optionId: "continue", label: "Continue" }],
        },
      ],
    },
    {
      type: "system-status",
      itemId: "status-1",
      createdAt: issuedAt,
      status: "content-available-on-desktop",
    },
  ]);
  assert.deepEqual(parseRemoteConversationPageV1(value), value);

  assert.equal(
    parseRemoteConversationPageV1(page(Array.from({ length: 51 }, (_, i) => message(`m-${i}`)))),
    undefined,
  );
  assert.equal(
    parseRemoteConversationPageV1(
      page([
        {
          ...message("oversized"),
          text: "界".repeat(70_000),
        },
      ]),
    ),
    undefined,
  );
  assert.equal(
    parseRemoteConversationPageV1(
      page([{ ...message("extra"), toolResult: { token: "must-not-pass" } }]),
    ),
    undefined,
  );
  assert.equal(
    parseRemoteConversationPageV1(
      page([
        {
          type: "assistant-message",
          itemId: "empty-assistant",
          createdAt: issuedAt,
          state: "complete",
        },
      ]),
    ),
    undefined,
  );
  assert.equal(
    parseRemoteConversationPageV1(
      page([
        {
          type: "tool-result",
          itemId: "unbounded-tool-result",
          createdAt: issuedAt,
          toolCallId: "tool-call-1",
          toolName: "read",
          output: "界".repeat(50_000),
          isError: false,
          truncated: false,
        },
      ]),
    ),
    undefined,
  );
});

test("accepts only text send, stop, and bounded ordinary-question answers", () => {
  assert.ok(
    parseRemoteOperationRequestV1(
      operation({ type: "session.send", sessionId: "session-1", text: "Hello" }),
    ),
  );
  assert.ok(
    parseRemoteOperationRequestV1(operation({ type: "session.stop", sessionId: "session-1" })),
  );
  assert.ok(
    parseRemoteOperationRequestV1(
      operation({
        type: "interaction.answerQuestion",
        sessionId: "session-1",
        interactionId: "interaction-1",
        interactionRevision: "interaction-revision-1",
        answers: [{ questionId: "question-1", optionIds: ["continue"], text: "Proceed" }],
      }),
    ),
  );
  assert.equal(
    parseRemoteOperationRequestV1(
      operation({
        type: "session.send",
        sessionId: "session-1",
        text: "Hello",
        attachments: [{ path: "/private/key" }],
      }),
    ),
    undefined,
  );
});

test("has no toolbox, file, terminal, browser, approval, or raw RPC command escape hatch", () => {
  const forbidden = [
    { type: "toolbox.execute", tool: "shell", arguments: { command: "whoami" } },
    { type: "file.read", path: "/private/key" },
    { type: "terminal.execute", command: "whoami" },
    { type: "browser.open", url: "https://example.test" },
    { type: "tool.approve", approvalId: "approval-1", approved: true },
    { type: "rpc.call", method: "session.send", payload: { text: "escape" } },
  ];
  for (const command of forbidden) {
    assert.equal(parseRemoteOperationRequestV1(operation(command)), undefined, command.type);
  }
});

test("strictly parses closed operation results without raw domain payloads", () => {
  const result = {
    type: "operation.result",
    operationId: "operation-1",
    state: "succeeded",
    value: { type: "message-accepted", sessionId: "session-1", messageId: "message-1" },
    appliedCursor: { epoch: "epoch-1", offset: "9" },
  } as const;
  assert.deepEqual(parseRemoteOperationResultV1(result), result);
  assert.equal(
    parseRemoteOperationResultV1({ ...result, rawResult: { path: "/private/file" } }),
    undefined,
  );
  assert.equal(
    parseRemoteOperationResultV1({
      ...result,
      value: { type: "tool-result", output: "private output" },
    }),
    undefined,
  );
});
