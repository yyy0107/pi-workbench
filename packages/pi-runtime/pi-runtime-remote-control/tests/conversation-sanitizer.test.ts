import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRemoteConversationPageV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";

import {
  projectRemoteConversationDelta,
  projectRemoteConversationPage,
} from "../src/conversation-projection.ts";

const base = {
  sessionId: "session-1",
  historyCursor: "history-1",
  sessionRevision: "session-revision-1",
  projectionCursor: { epoch: "epoch-1", offset: "9" },
} as const;

test("projects visible AI text, tool inputs, and raw text outputs without hidden reasoning", () => {
  const projected = projectRemoteConversationPage({
    ...base,
    entries: [
      {
        id: "user-1",
        role: "user",
        timestamp: "2030-09-13T20:00:00.000Z",
        content: [
          { type: "text", text: "Please inspect the project" },
          { type: "file", source: { path: "/Users/private/.ssh/id_ed25519" } },
          { type: "attachment", data: "attachment-secret" },
        ],
        cwd: "/Users/private/project",
      },
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: "2030-09-13T20:00:01.000Z",
        content: [
          { type: "text", text: "I checked the project." },
          {
            type: "toolCall",
            id: "tool-1",
            name: "read",
            arguments: { path: "/Users/private/project/secret.txt", token: "tool-arg-secret" },
          },
          { type: "reasoning", text: "model-reasoning-secret" },
        ],
      },
      {
        id: "tool-result-1",
        role: "toolResult",
        timestamp: "2030-09-13T20:00:02.000Z",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "tool-result-secret" }],
        details: { absolutePath: "/Users/private/project/secret.txt" },
      },
      {
        id: "bash-result-1",
        role: "bashExecution",
        timestamp: "2030-09-13T20:00:02.500Z",
        command: "pnpm test",
        output: "42 tests passed\n",
        exitCode: 0,
      },
      {
        id: "raw-error-1",
        type: "error",
        timestamp: "2030-09-13T20:00:03.000Z",
        error: new Error("provider-token-secret"),
        stack: "/Users/private/provider.ts:1",
      },
      {
        id: "unknown-1",
        type: "host.privateEvent",
        timestamp: "2030-09-13T20:00:04.000Z",
        payload: { apiKey: "unknown-event-secret" },
      },
    ],
  });

  assert.ok(parseRemoteConversationPageV1(projected));
  assert.equal(projected.items[0]?.type, "user-message");
  assert.equal(projected.items[1]?.type, "assistant-message");
  const assistant = projected.items.find((item) => item.type === "assistant-message");
  assert.equal(assistant?.text, "I checked the project.");
  assert.deepEqual(assistant?.toolCalls, [
    {
      toolCallId: "tool-1",
      toolName: "read",
      arguments: '{"path":"/Users/private/project/secret.txt","token":"tool-arg-secret"}',
      truncated: false,
    },
  ]);
  const toolResult = projected.items.find(
    (item) => item.type === "tool-result" && item.toolName === "read",
  );
  assert.equal(toolResult?.type, "tool-result");
  if (toolResult?.type === "tool-result") {
    assert.equal(toolResult.output, "tool-result-secret");
    assert.equal(toolResult.truncated, false);
  }
  const bashResult = projected.items.find(
    (item) => item.type === "tool-result" && item.toolName === "bash",
  );
  assert.equal(bashResult?.type, "tool-result");
  if (bashResult?.type === "tool-result") {
    assert.equal(bashResult.input, "pnpm test");
    assert.equal(bashResult.output, "42 tests passed\n");
  }
  const serialized = JSON.stringify(projected);
  for (const secret of [
    "attachment-secret",
    "model-reasoning-secret",
    "provider-token-secret",
    "unknown-event-secret",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(serialized.includes("absolutePath"), false);
  assert.equal(serialized.includes("content-available-on-desktop"), false);
});

test("projects each persisted journal message once from its terminal lifecycle event", () => {
  const user = {
    role: "user",
    timestamp: 1_915_747_200_000,
    content: [{ type: "text", text: "Hello" }],
  };
  const assistant = {
    role: "assistant",
    timestamp: 1_915_747_201_000,
    content: [{ type: "text", text: "Hello! How can I help?" }],
    stopReason: "stop",
  };
  const projected = projectRemoteConversationPage({
    ...base,
    entries: [
      {
        entryId: "user-start",
        event: { type: "message_start", time: user.timestamp, data: { message: user } },
      },
      {
        entryId: "user-end",
        event: { type: "message_end", time: user.timestamp + 1, data: { message: user } },
      },
      {
        entryId: "assistant-start",
        event: {
          type: "message_start",
          time: assistant.timestamp,
          data: { message: { ...assistant, content: [], stopReason: "pending" } },
        },
      },
      {
        entryId: "assistant-update",
        event: {
          type: "message_update",
          time: assistant.timestamp + 1,
          data: { message: assistant },
        },
      },
      {
        entryId: "assistant-end",
        event: { type: "message_end", time: assistant.timestamp + 2, data: { message: assistant } },
      },
      {
        entryId: "turn-end",
        event: { type: "turn_end", time: assistant.timestamp + 3, data: { message: assistant } },
      },
    ],
  });

  assert.deepEqual(
    projected.items.map((item) => ({
      id: "itemId" in item ? item.itemId : item.interactionId,
      type: item.type,
    })),
    [
      { id: "user-end", type: "user-message" },
      { id: "assistant-end", type: "assistant-message" },
    ],
  );
});

test("projects canonical desktop conversation nodes with tool timelines and context summaries", () => {
  const projected = projectRemoteConversationPage({
    ...base,
    entries: [
      {
        key: "assistant-canonical",
        kind: "assistant",
        createdAt: 1_915_747_201_000,
        status: "complete",
        blocks: [
          { key: "reasoning-1", kind: "reasoning", text: "Checked the repository." },
          {
            key: "context-1",
            kind: "data",
            name: "workbench.pi-context-trace-event",
            data: {
              version: 1,
              promptInjection: "tools",
              event: {
                schemaVersion: 1,
                traceId: "trace-1",
                sessionId: "session-1",
                activationId: "activation-1",
                seq: 1,
                time: 1_915_747_200_500,
                kind: "prompt-composition",
                promptResources: { tools: { active: ["read", "exec"] } },
              },
            },
          },
          {
            key: "tool-1",
            kind: "tool-call",
            callId: "call-1",
            toolName: "read",
            argumentsText: '{"path":"README.md"}',
            status: "complete",
            result: { text: "raw output", details: { source: "runtime" } },
          },
          { key: "text-1", kind: "text", text: "Done." },
          {
            key: "file-1",
            kind: "file",
            name: "secret.txt",
            source: "private-file-content",
          },
          { key: "data-private", kind: "data", name: "private.data", data: "private-data" },
        ],
      },
    ],
  });

  assert.ok(parseRemoteConversationPageV1(projected));
  assert.equal(projected.items.length, 1);
  const item = projected.items[0];
  assert.equal(item?.type, "conversation-node");
  if (item?.type !== "conversation-node") return;
  assert.equal(item.kind, "assistant");
  assert.deepEqual(
    item.blocks?.map((block) => block.kind),
    ["reasoning", "data", "tool-call", "text"],
  );
  const tool = item.blocks?.find((block) => block.kind === "tool-call");
  assert.equal(tool?.kind, "tool-call");
  if (tool?.kind === "tool-call") {
    assert.deepEqual(tool.result, { text: "raw output", details: { source: "runtime" } });
  }
  const serialized = JSON.stringify(item);
  assert.equal(serialized.includes("private-file-content"), false);
  assert.equal(serialized.includes("private-data"), false);
});

test("bounds a history page by 50 items and 192 KiB using UTF-8 bytes", () => {
  const projected = projectRemoteConversationPage({
    ...base,
    nextCursor: "history-2",
    entries: Array.from({ length: 80 }, (_, index) => ({
      id: `assistant-${index}`,
      role: "assistant",
      timestamp: `2030-09-13T20:00:${String(index % 60).padStart(2, "0")}.000Z`,
      content: [
        {
          type: "text",
          text: index === 0 ? "界".repeat(70_000) : `第${index}项${"界".repeat(1_000)}`,
        },
      ],
    })),
  });

  assert.ok(projected.items.length <= 50);
  assert.ok(remoteUtf8ByteLength(JSON.stringify(projected)) <= 192 * 1024);
  assert.equal(projected.nextCursor, "history-2");
  assert.ok(parseRemoteConversationPageV1(projected));
  assert.equal(JSON.stringify(projected).includes("界".repeat(70_000)), false);
  const first = projected.items[0];
  assert.equal(first?.type, "assistant-message");
  if (first?.type === "assistant-message") assert.equal(first.textTruncated, true);
});

test("preserves ordinary raw tool output and marks oversized UTF-8 output as truncated", () => {
  const exact = "first line\n第二行\n";
  const projected = projectRemoteConversationPage({
    ...base,
    entries: [
      {
        id: "tool-result-exact",
        role: "toolResult",
        timestamp: "2030-09-13T20:00:00.000Z",
        toolCallId: "tool-exact",
        toolName: "exec",
        content: [{ type: "text", text: exact }],
        isError: false,
      },
      {
        id: "tool-result-large",
        role: "toolResult",
        timestamp: "2030-09-13T20:00:01.000Z",
        toolCallId: "tool-large",
        toolName: "exec",
        content: [{ type: "text", text: "界".repeat(50_000) }],
        isError: false,
      },
    ],
  });

  const [exactResult, largeResult] = projected.items;
  assert.equal(exactResult?.type, "tool-result");
  if (exactResult?.type === "tool-result") {
    assert.equal(exactResult.output, exact);
    assert.equal(exactResult.truncated, false);
  }
  assert.equal(largeResult?.type, "tool-result");
  if (largeResult?.type === "tool-result") {
    assert.equal(largeResult.truncated, true);
    assert.ok(remoteUtf8ByteLength(largeResult.output) <= 128 * 1024);
    assert.equal(largeResult.output.includes("�"), false);
  }
  assert.ok(parseRemoteConversationPageV1(projected));
});

test("projects only ordinary questions and UTF-8 bounded assistant deltas", () => {
  const projected = projectRemoteConversationPage({
    ...base,
    entries: [
      {
        type: "question/requested",
        rpcId: "question-rpc-1",
        revision: "question-revision-1",
        expiresAt: "2030-09-13T20:05:00.000Z",
        questions: [
          {
            id: "continue",
            question: "Continue?",
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
        ],
      },
      {
        type: "approval/requested",
        approvalId: "approval-1",
        toolCall: { arguments: { command: "private-command" } },
      },
    ],
  });
  assert.equal(projected.items[0]?.type, "ordinary-question");
  assert.equal(JSON.stringify(projected).includes("private-command"), false);

  assert.deepEqual(
    projectRemoteConversationDelta({
      sessionId: "session-1",
      streamId: "stream-1",
      revision: "stream-revision-1",
      delta: "界".repeat(5_000),
    }),
    {
      type: "session.messageDelta",
      sessionId: "session-1",
      streamId: "stream-1",
      revision: "stream-revision-1",
      delta: "界".repeat(5_000),
    },
  );
  assert.throws(
    () =>
      projectRemoteConversationDelta({
        sessionId: "session-1",
        streamId: "stream-1",
        revision: "stream-revision-2",
        delta: "界".repeat(6_000),
      }),
    /conversation_delta_invalid/u,
  );
});
