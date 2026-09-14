import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteConversationItemV1 } from "@workbench/remote-control-contracts/protocol";

import {
  remoteConversationNodes,
  remoteConversationTranscript,
} from "../lib/remote-conversation-model";

const timestamp = "2030-09-13T20:00:00.000Z";

test("joins projected tool results to their assistant tool calls", () => {
  const items: readonly RemoteConversationItemV1[] = [
    {
      type: "assistant-message",
      itemId: "assistant-1",
      createdAt: timestamp,
      state: "complete",
      text: "Done.",
      toolCalls: [
        {
          toolCallId: "tool-1",
          toolName: "read",
          arguments: '{"path":"README.md"}',
          truncated: false,
        },
      ],
    },
    {
      type: "tool-result",
      itemId: "result-1",
      createdAt: timestamp,
      toolCallId: "tool-1",
      toolName: "read",
      output: "contents",
      isError: false,
      truncated: false,
    },
  ];

  const transcript = remoteConversationTranscript(items);
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.kind, "assistant");
  if (transcript[0]?.kind !== "assistant") return;
  assert.deepEqual(transcript[0].tools, [
    {
      toolCallId: "tool-1",
      toolName: "read",
      input: '{"path":"README.md"}',
      output: "contents",
      running: false,
      failed: false,
      truncated: false,
    },
  ]);
});

test("keeps standalone results and excludes native-owned ordinary questions", () => {
  const items: readonly RemoteConversationItemV1[] = [
    {
      type: "ordinary-question",
      interactionId: "question-1",
      sessionId: "session-1",
      revision: "1",
      expiresAt: timestamp,
      questions: [{ questionId: "continue", prompt: "Continue?" }],
    },
    {
      type: "tool-result",
      itemId: "result-1",
      createdAt: timestamp,
      toolCallId: "tool-1",
      toolName: "bash",
      input: "pnpm test",
      output: "passed",
      isError: false,
      truncated: true,
    },
  ];

  const transcript = remoteConversationTranscript(items);
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0]?.kind, "tool");
  if (transcript[0]?.kind !== "tool") return;
  assert.equal(transcript[0].tool.output, "passed");
  assert.equal(transcript[0].tool.truncated, true);
});

test("rehydrates canonical remote nodes for the shared desktop message renderer", () => {
  const nodes = remoteConversationNodes([
    {
      type: "conversation-node",
      itemId: "assistant-1",
      createdAt: timestamp,
      kind: "assistant",
      status: "complete",
      blocks: [
        {
          kind: "data",
          key: "context-1",
          name: "workbench.pi-context-trace-event",
          data: { version: 1, event: { kind: "prompt-composition" } },
        },
        {
          kind: "tool-call",
          key: "tool-1",
          callId: "call-1",
          toolName: "exec",
          argumentsText: '{"cmd":"pnpm test"}',
          status: "complete",
          result: { text: "passed" },
          truncated: false,
        },
        { kind: "text", key: "text-1", text: "Done." },
      ],
    },
  ]);

  assert.equal(nodes.length, 1);
  const node = nodes[0];
  assert.equal(node?.kind, "assistant");
  if (node?.kind !== "assistant") return;
  assert.deepEqual(
    node.blocks.map((block) => block.kind),
    ["data", "tool-call", "text"],
  );
  const tool = node.blocks[1];
  assert.equal(tool?.kind, "tool-call");
  if (tool?.kind === "tool-call") assert.deepEqual(tool.result, { text: "passed" });
});
