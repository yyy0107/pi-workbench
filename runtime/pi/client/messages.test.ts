import assert from "node:assert/strict";
import test from "node:test";

import type { AppendMessage, MessageTiming, ThreadMessage } from "@assistant-ui/react";

import type { PiAssistantMessage, PiSessionHistory } from "../contracts";

const {
  coalesceConsecutiveAssistantMessages,
  optimisticUserMessage,
  piAssistantToThreadMessage,
  piHistoryToThreadMessages,
} = (await import(new URL("./messages.ts", import.meta.url).href)) as typeof import("./messages");

const assistantMessage: PiAssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Hello" }],
};

test("marks temporary assistant messages as optimistic", () => {
  const streaming = piAssistantToThreadMessage(assistantMessage, "stream", {
    optimistic: true,
    streaming: true,
  });
  const completed = piAssistantToThreadMessage(assistantMessage, "live", {
    optimistic: true,
  });
  const persisted = piAssistantToThreadMessage(assistantMessage, "history");

  assert.equal(streaming.metadata.isOptimistic, true);
  assert.equal(completed.metadata.isOptimistic, true);
  assert.equal(persisted.metadata.isOptimistic, undefined);
});

test("marks optimistic user messages for repository eviction", () => {
  const message: AppendMessage = {
    role: "user",
    content: [{ type: "text", text: "Hello" }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };

  const optimistic = optimisticUserMessage(message, "user-live");

  assert.equal(optimistic.metadata.isOptimistic, true);
  assert.equal(optimistic.metadata.custom.piOptimistic, true);
});

test("preserves assistant usage and timing metadata", () => {
  const timing: MessageTiming = {
    streamStartTime: 1_000,
    firstTokenTime: 400,
    totalStreamTime: 2_600,
    tokenCount: 52,
    tokensPerSecond: 20,
    totalChunks: 8,
    toolCallCount: 0,
  };
  const message: PiAssistantMessage = {
    ...assistantMessage,
    usage: {
      input: 1_200,
      output: 52,
      cacheRead: 800,
      cacheWrite: 0,
      totalTokens: 2_052,
    },
  };

  const converted = piAssistantToThreadMessage(message, "with-stats", { timing });

  assert.deepEqual(converted.metadata.timing, timing);
  assert.deepEqual(converted.metadata.custom.piUsage, {
    input: 1_200,
    output: 52,
    cacheRead: 800,
    cacheWrite: 0,
    totalTokens: 2_052,
  });
});

test("coalesces consecutive assistant records into one message", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["user", "assistant-1", "result-1", "assistant-2", "result-2"],
      thinkingLevel: "medium",
      model: null,
      messages: [
        { role: "user", content: "Fix it", timestamp: 1 },
        {
          role: "assistant",
          timestamp: 2,
          content: [
            { type: "text", text: "First:" },
            { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "a.ts" } },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          content: [{ type: "text", text: "read-result" }],
        },
        {
          role: "assistant",
          timestamp: 3,
          content: [
            { type: "thinking", thinking: "Continue" },
            { type: "toolCall", id: "tool-2", name: "edit", arguments: { path: "a.ts" } },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-2",
          content: [{ type: "text", text: "edit-result" }],
        },
      ],
    },
  };

  const converted = piHistoryToThreadMessages(history);

  assert.deepEqual(
    converted.map((message) => message.role),
    ["user", "assistant"],
  );
  const assistant = converted[1];
  assert.equal(assistant?.role, "assistant");
  if (assistant?.role !== "assistant") return;
  assert.equal(assistant.id, "assistant-1");
  assert.deepEqual(
    assistant.content.map((part) => part.type),
    ["text", "tool-call", "reasoning", "tool-call"],
  );
  const toolResults = assistant.content
    .filter((part) => part.type === "tool-call")
    .map((part) => part.result);
  assert.deepEqual(toolResults, ["read-result", "edit-result"]);
});

test("keeps visible message boundaries between assistant runs", () => {
  const first = piAssistantToThreadMessage(assistantMessage, "first");
  const second = piAssistantToThreadMessage(assistantMessage, "second");
  const boundary: ThreadMessage = {
    id: "boundary",
    role: "system",
    content: [{ type: "text", text: "Visible command output" }],
    createdAt: new Date(1),
    metadata: { custom: {} },
  };

  const coalesced = coalesceConsecutiveAssistantMessages([
    first,
    second,
    boundary,
    piAssistantToThreadMessage(assistantMessage, "third"),
  ]);

  assert.deepEqual(
    coalesced.map((message) => message.id),
    ["first", "boundary", "third"],
  );
});

test("does not let an empty streaming placeholder split a merged tool timeline", () => {
  const completed = piAssistantToThreadMessage(
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "tool", name: "read", arguments: {} }],
    },
    "completed",
  );
  const streaming = piAssistantToThreadMessage({ role: "assistant", content: [] }, "streaming", {
    optimistic: true,
    streaming: true,
  });

  const [merged] = coalesceConsecutiveAssistantMessages([completed, streaming]);

  assert.equal(merged?.role, "assistant");
  if (merged?.role !== "assistant") return;
  assert.deepEqual(
    merged.content.map((part) => part.type),
    ["tool-call"],
  );
  assert.equal(merged.status.type, "running");
});
