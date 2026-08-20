import assert from "node:assert/strict";
import test from "node:test";

import type { AppendMessage, MessageTiming, ThreadMessage } from "@assistant-ui/react";

import {
  PI_CONVERSATION_EVENT_CUSTOM_TYPE,
  type PiAssistantMessage,
  type PiSessionHistory,
} from "../../contracts";
import {
  applyToolExecutionUpdate,
  coalesceConsecutiveAssistantMessages,
  optimisticUserMessage,
  piAssistantToThreadMessage,
  piHistoryToThreadMessages,
  reconcileLiveMessagesAfterHistory,
} from "./messages";
import { conversationEventThreadMessage } from "./conversation-events";

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

test("keeps an optimistic user message when a running history refresh has not persisted it", () => {
  const appendMessage: AppendMessage = {
    role: "user",
    content: [{ type: "text", text: "Repeated prompt" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };
  const optimistic = optimisticUserMessage(appendMessage, "user-live");
  const priorPersisted = {
    id: "user-old",
    role: "user",
    content: [{ type: "text", text: "Repeated prompt" }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
  } satisfies ThreadMessage;

  const reconciled = reconcileLiveMessagesAfterHistory([optimistic], [priorPersisted], {
    liveMessageIdsAtStart: new Set([optimistic.id]),
    baseMessageIdsAtStart: new Set([priorPersisted.id]),
    preserveUnpersistedOptimisticUsers: true,
  });

  assert.deepEqual(
    reconciled.map((message) => message.id),
    ["user-live"],
  );
});

test("replaces an optimistic user message once the refreshed history contains its prompt", () => {
  const appendMessage: AppendMessage = {
    role: "user",
    content: [{ type: "text", text: "Hello" }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };
  const optimistic = optimisticUserMessage(appendMessage, "user-live");
  const persisted = {
    id: "user-persisted",
    role: "user",
    content: [{ type: "text", text: "Hello" }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: { piEntryId: "pi-event-1" } },
  } satisfies ThreadMessage;

  const reconciled = reconcileLiveMessagesAfterHistory([optimistic], [persisted], {
    liveMessageIdsAtStart: new Set([optimistic.id]),
    baseMessageIdsAtStart: new Set(),
    preserveUnpersistedOptimisticUsers: true,
  });

  assert.deepEqual(reconciled, []);
});

test("clears captured optimistic user messages during an idle history refresh", () => {
  const optimistic = optimisticUserMessage(
    {
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      attachments: [],
      createdAt: new Date(0),
      metadata: { custom: {} },
      parentId: null,
      runConfig: undefined,
      sourceId: null,
    },
    "user-live",
  );

  const reconciled = reconcileLiveMessagesAfterHistory([optimistic], [], {
    liveMessageIdsAtStart: new Set([optimistic.id]),
    baseMessageIdsAtStart: new Set(),
    preserveUnpersistedOptimisticUsers: false,
  });

  assert.deepEqual(reconciled, []);
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

test("preserves Pi diagnostics and exposes the normalized termination metadata", () => {
  const converted = piAssistantToThreadMessage(
    {
      ...assistantMessage,
      stopReason: "error",
      rawStopReason: "failed",
      errorMessage: "fetch failed",
      diagnostics: [
        {
          type: "provider_transport_failure",
          timestamp: 1,
          error: { message: "socket closed", code: "ECONNRESET" },
        },
        {
          type: "workbench.message-termination.v1",
          timestamp: 2,
          details: {
            schemaVersion: 1,
            kind: "network-error",
            stopReason: "error",
            rawStopReason: "failed",
            errorMessage: "fetch failed",
          },
        },
      ],
    },
    "failed",
  );

  assert.equal(converted.metadata.custom.piRawStopReason, "failed");
  assert.deepEqual(converted.metadata.custom.piTermination, {
    schemaVersion: 1,
    kind: "network-error",
    stopReason: "error",
    rawStopReason: "failed",
    errorMessage: "fetch failed",
  });
  assert.equal(
    (converted.metadata.custom.piDiagnostics as Array<{ type: string }>)[0]?.type,
    "provider_transport_failure",
  );
});

test("preserves a live reasoning start time across renderer remounts", () => {
  const converted = piAssistantToThreadMessage(
    {
      role: "assistant",
      timestamp: 1_000,
      content: [{ type: "thinking", thinking: "Plan" }],
    },
    "live-reasoning",
    {
      streaming: true,
      timing: {
        streamStartTime: 1_000,
        totalChunks: 3,
        toolCallCount: 0,
      },
    },
  );

  assert.equal(converted.role, "assistant");
  if (converted.role !== "assistant") return;
  const reasoning = converted.content[0];
  assert.equal(reasoning?.type, "reasoning");
  if (reasoning?.type !== "reasoning") return;
  assert.deepEqual(reasoning.providerMetadata, { pi: { startedAt: 1_000 } });
});

test("preserves completed reasoning and tool durations on message parts", () => {
  const toolTiming = { startedAt: 2_000, completedAt: 5_400 };
  const converted = piAssistantToThreadMessage(
    {
      role: "assistant",
      timestamp: 1_000,
      content: [
        { type: "thinking", thinking: "Plan" },
        { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "a.ts" } },
      ],
    },
    "timed-parts",
    {
      timing: {
        streamStartTime: 1_000,
        totalStreamTime: 2_600,
        totalChunks: 4,
        toolCallCount: 1,
      },
      toolTimingById: new Map([["tool-1", toolTiming]]),
    },
  );

  assert.equal(converted.role, "assistant");
  if (converted.role !== "assistant") return;
  const reasoning = converted.content[0];
  const tool = converted.content[1];
  assert.equal(reasoning?.type, "reasoning");
  assert.equal(tool?.type, "tool-call");
  if (reasoning?.type !== "reasoning" || tool?.type !== "tool-call") return;
  assert.deepEqual(reasoning.providerMetadata, { pi: { startedAt: 1_000, durationMs: 2_600 } });
  assert.deepEqual(tool.timing, toolTiming);
});

test("marks tool calls from one assistant message as the same parallel batch", () => {
  const converted = piAssistantToThreadMessage(
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "read-call", name: "read", arguments: { path: "a.ts" } },
        { type: "toolCall", id: "search-call", name: "search", arguments: { query: "x" } },
      ],
    },
    "assistant-batch",
  );

  assert.equal(converted.role, "assistant");
  if (converted.role !== "assistant") return;
  const tools = converted.content.filter((part) => part.type === "tool-call");
  assert.equal(tools.length, 2);
  for (const tool of tools) {
    assert.deepEqual(tool.providerMetadata, {
      pi: {
        parallelToolBatchId: "read-call",
        parallelToolBatchSize: 2,
      },
    });
  }
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

test("measures a completed turn from the user message through tools and final output", () => {
  const user: ThreadMessage = {
    id: "user",
    role: "user",
    content: [{ type: "text", text: "Fix it" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: { custom: {} },
  };
  const first = piAssistantToThreadMessage(
    {
      role: "assistant",
      timestamp: 2_000,
      content: [{ type: "toolCall", id: "tool", name: "read", arguments: {} }],
    },
    "first",
    {
      timing: {
        streamStartTime: 2_000,
        totalStreamTime: 1_000,
        totalChunks: 2,
        toolCallCount: 1,
      },
      toolTimingById: new Map([["tool", { startedAt: 3_000, completedAt: 10_000 }]]),
    },
  );
  const final = piAssistantToThreadMessage(
    {
      role: "assistant",
      timestamp: 11_000,
      content: [{ type: "text", text: "Done" }],
    },
    "final",
    {
      timing: {
        streamStartTime: 11_000,
        totalStreamTime: 2_000,
        totalChunks: 3,
        toolCallCount: 0,
      },
    },
  );

  const [, merged] = coalesceConsecutiveAssistantMessages([user, first, final]);
  assert.equal(merged?.role, "assistant");
  if (merged?.role !== "assistant") return;
  assert.deepEqual(merged.metadata.custom.piTurnTiming, {
    startedAt: 1_000,
    completedAt: 13_000,
  });
  assert.deepEqual(merged.metadata.timing, final.metadata.timing);
});

test("derives persisted tool timing from assistant and result timestamps", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["assistant", "result"],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "assistant",
          timestamp: 10_000,
          content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: {} }],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          content: [{ type: "text", text: "done" }],
          timestamp: 12_400,
        },
      ],
    },
  };

  const [message] = piHistoryToThreadMessages(history);
  assert.equal(message?.role, "assistant");
  if (message?.role !== "assistant") return;
  const [tool] = message.content;
  assert.equal(tool?.type, "tool-call");
  if (tool?.type !== "tool-call") return;
  assert.deepEqual(tool.timing, { startedAt: 10_000, completedAt: 12_400 });
});

test("restores each parallel tool's independently persisted timing", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["assistant", "result-1", "result-2"],
      toolTimings: [
        { toolCallId: "tool-1", startedAt: 10_000, completedAt: 11_200 },
        { toolCallId: "tool-2", startedAt: 10_050, completedAt: 13_600 },
      ],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "assistant",
          timestamp: 9_500,
          content: [
            { type: "toolCall", id: "tool-1", name: "read", arguments: {} },
            { type: "toolCall", id: "tool-2", name: "bash", arguments: {} },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          content: [{ type: "text", text: "first" }],
          timestamp: 14_000,
        },
        {
          role: "toolResult",
          toolCallId: "tool-2",
          content: [{ type: "text", text: "second" }],
          timestamp: 14_001,
        },
      ],
    },
  };

  const [message] = piHistoryToThreadMessages(history);
  assert.equal(message?.role, "assistant");
  if (message?.role !== "assistant") return;
  const tools = message.content.filter((part) => part.type === "tool-call");
  assert.deepEqual(tools[0]?.timing, { startedAt: 10_000, completedAt: 11_200 });
  assert.deepEqual(tools[1]?.timing, { startedAt: 10_050, completedAt: 13_600 });
});

test("does not treat a parallel batch result timestamp as each tool's duration", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["assistant", "result-1", "result-2"],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "assistant",
          timestamp: 10_000,
          content: [
            { type: "toolCall", id: "tool-1", name: "read", arguments: {} },
            { type: "toolCall", id: "tool-2", name: "bash", arguments: {} },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          content: [{ type: "text", text: "first" }],
          timestamp: 14_000,
        },
        {
          role: "toolResult",
          toolCallId: "tool-2",
          content: [{ type: "text", text: "second" }],
          timestamp: 14_001,
        },
      ],
    },
  };

  const [message] = piHistoryToThreadMessages(history);
  assert.equal(message?.role, "assistant");
  if (message?.role !== "assistant") return;
  const tools = message.content.filter((part) => part.type === "tool-call");
  assert.equal(tools[0]?.timing, undefined);
  assert.equal(tools[1]?.timing, undefined);
});

test("restores completed reasoning duration from the persisted entry timestamp", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["assistant"],
      entryCompletedAts: [12_600],
      thinkingLevel: "medium",
      model: null,
      messages: [
        {
          role: "assistant",
          timestamp: 10_000,
          usage: {
            input: 100,
            output: 52,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 152,
          },
          content: [{ type: "thinking", thinking: "Plan" }],
        },
      ],
    },
  };

  const [message] = piHistoryToThreadMessages(history);
  assert.equal(message?.role, "assistant");
  if (message?.role !== "assistant") return;
  const [reasoning] = message.content;
  assert.equal(reasoning?.type, "reasoning");
  if (reasoning?.type !== "reasoning") return;
  assert.deepEqual(reasoning.providerMetadata, { pi: { startedAt: 10_000, durationMs: 2_600 } });
  assert.deepEqual(message.metadata.timing, {
    streamStartTime: 10_000,
    totalStreamTime: 2_600,
    tokenCount: 52,
    tokensPerSecond: 20,
    totalChunks: 0,
    toolCallCount: 0,
  });
});

test("keeps duplicate entry ids unique in encounter order", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["shared", "shared", "other", "shared"],
      thinkingLevel: "off",
      model: null,
      messages: [
        { role: "user", content: "one" },
        { role: "user", content: "two" },
        { role: "user", content: "three" },
        { role: "user", content: "four" },
      ],
    },
  };

  assert.deepEqual(
    piHistoryToThreadMessages(history).map((message) => message.id),
    ["shared", "shared-1", "other", "shared-2"],
  );
});

test("preserves conversation event metadata on system messages", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["compaction"],
      entryCompletedAts: [5_000],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "custom",
          customType: PI_CONVERSATION_EVENT_CUSTOM_TYPE,
          content: "",
          display: true,
          details: {
            kind: "compaction",
            reason: "threshold",
            tokensBefore: 90_000,
            estimatedTokensAfter: 12_000,
          },
        },
      ],
    },
  };

  const [message] = piHistoryToThreadMessages(history);
  assert.equal(message?.role, "system");
  assert.equal(message?.createdAt.getTime(), 5_000);
  assert.deepEqual(message?.metadata.custom.piConversationEvent, {
    kind: "compaction",
    reason: "threshold",
    tokensBefore: 90_000,
    estimatedTokensAfter: 12_000,
  });
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

test("collapses consecutive model changes to the first source and final target", () => {
  const first = conversationEventThreadMessage(
    {
      kind: "model-change",
      previousProvider: "opencode-go",
      previousModel: "deepseek-v4-preview",
      provider: "deepseek",
      model: "deepseek-v4-pro",
    },
    "first-model-change",
    1,
  );
  const final = conversationEventThreadMessage(
    {
      kind: "model-change",
      previousProvider: "deepseek",
      previousModel: "deepseek-v4-pro",
      provider: "opencode-go",
      model: "deepseek-v4-final",
    },
    "final-model-change",
    2,
  );

  const coalesced = coalesceConsecutiveAssistantMessages([first, final]);

  assert.equal(coalesced.length, 1);
  assert.equal(coalesced[0]?.id, "first-model-change");
  assert.deepEqual(coalesced[0]?.metadata.custom.piConversationEvent, {
    kind: "model-change",
    previousProvider: "opencode-go",
    previousModel: "deepseek-v4-preview",
    provider: "opencode-go",
    model: "deepseek-v4-final",
  });
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

test("streams partial tool output through artifacts until the result completes", () => {
  const messages = [
    piAssistantToThreadMessage(
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "bash-call", name: "bash", arguments: { command: "build" } },
        ],
      },
      "assistant",
    ),
  ];

  assert.equal(
    applyToolExecutionUpdate(messages, {
      state: "running",
      toolCallId: "bash-call",
      partialResult: { content: [{ type: "text", text: "first line" }] },
      startedAt: 1_000,
    }),
    true,
  );

  const runningMessage = messages[0];
  assert.equal(runningMessage?.role, "assistant");
  if (runningMessage?.role !== "assistant") return;
  const runningPart = runningMessage.content[0];
  assert.equal(runningMessage.status.type, "running");
  assert.equal(runningPart?.type, "tool-call");
  if (runningPart?.type !== "tool-call") return;
  assert.equal(runningPart.result, undefined);
  assert.equal(runningPart.artifact, "first line");
  assert.deepEqual(runningPart.timing, { startedAt: 1_000 });

  applyToolExecutionUpdate(messages, {
    state: "complete",
    toolCallId: "bash-call",
    result: {
      content: [{ type: "text", text: "first line\nsecond line" }],
      details: { exitCode: 0 },
    },
    isError: false,
    completedAt: 4_500,
  });

  const completedMessage = messages[0];
  assert.equal(completedMessage?.role, "assistant");
  if (completedMessage?.role !== "assistant") return;
  const completedPart = completedMessage.content[0];
  assert.equal(completedMessage.status.type, "complete");
  assert.equal(completedPart?.type, "tool-call");
  if (completedPart?.type !== "tool-call") return;
  assert.equal(completedPart.artifact, undefined);
  assert.deepEqual(completedPart.result, {
    text: "first line\nsecond line",
    details: { exitCode: 0 },
  });
  assert.deepEqual(completedPart.timing, { startedAt: 1_000, completedAt: 4_500 });
});

test("keeps a message running while another parallel tool has no result", () => {
  const messages = [
    piAssistantToThreadMessage(
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "first", name: "bash", arguments: {} },
          { type: "toolCall", id: "second", name: "bash", arguments: {} },
        ],
      },
      "assistant",
    ),
  ];

  applyToolExecutionUpdate(messages, {
    state: "complete",
    toolCallId: "first",
    result: { content: [{ type: "text", text: "done" }] },
    isError: false,
  });

  const message = messages[0];
  assert.equal(message?.role, "assistant");
  if (message?.role !== "assistant") return;
  assert.equal(message.status.type, "running");
});
