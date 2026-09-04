import assert from "node:assert/strict";
import test from "node:test";

import { PI_CONVERSATION_EVENT_CUSTOM_TYPE } from "@workbench/agent-runtime-pi-protocol/messages";
import { piHistoryToThreadMessages } from "../../src/messages/messages";

import {
  piHistoryFromSessionEvents,
  piPromptContent,
  piSummaryFromSessionListItem,
  WORKBENCH_SESSION_SUMMARY_PROJECTION,
} from "../../src/sessions/session-rpc-projection";

test("adapts session list metadata carried in protocol projections", () => {
  const summary = piSummaryFromSessionListItem({
    sessionId: "s-1",
    updatedAt: 2_000,
    running: true,
    waitingForUserInput: true,
    runTiming: { startedAt: 1_500, elapsedMs: 500 },
    blank: false,
    cwd: "/work",
    projections: {
      asOfSeq: 4,
      values: {
        [WORKBENCH_SESSION_SUMMARY_PROJECTION]: {
          id: "ignored",
          cwd: "/work",
          workspace: { id: "w-1", name: "Work", cwd: "/work" },
          name: "Protocol migration",
          created: "1970-01-01T00:00:01.000Z",
          modified: "ignored",
          messageCount: 3,
          firstMessage: "hello",
          transient: false,
          running: false,
          automationOrigin: {
            version: 1,
            origin: "automation",
            automationId: "automation-1",
            automationName: "Morning briefing",
            source: "schedule",
            triggeredAt: 1_777_000_000_000,
          },
        },
      },
    },
  });

  assert.equal(summary.id, "s-1");
  assert.equal(summary.name, "Protocol migration");
  assert.equal(summary.modified, "1970-01-01T00:00:02.000Z");
  assert.equal(summary.running, true);
  assert.equal(summary.waitingForUserInput, true);
  assert.deepEqual(summary.runTiming, { startedAt: 1_500, elapsedMs: 500 });
  assert.deepEqual(summary.workspace, { id: "w-1", name: "Work", cwd: "/work" });
  assert.equal(summary.automationOrigin?.automationName, "Morning briefing");
  assert.equal(summary.automationOrigin?.source, "schedule");
});

test("normalizes legacy Composer protocols before session titles enter the thread list", () => {
  const summary = piSummaryFromSessionListItem({
    sessionId: "s-legacy-title",
    updatedAt: 2_000,
    running: false,
    blank: false,
    cwd: "/work",
    projections: {
      asOfSeq: 1,
      values: {
        [WORKBENCH_SESSION_SUMMARY_PROJECTION]: {
          name: ":pi-command[skill%3Aapple-design|Apple%20Design] 这是什么",
        },
      },
    },
  });

  assert.equal(summary.name, "Apple Design 这是什么");
});

test("adapts canonical message groups and durable tool timing", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message_end",
          seq: 0,
          time: 10,
          entryId: "journal-user-1",
          data: { message: { role: "user", content: "hello", timestamp: 5 } },
        },
      },
      {
        event: {
          type: "tool_execution_start",
          seq: 1,
          time: 20,
          data: { toolCallId: "tool-1" },
        },
      },
      {
        event: {
          type: "tool_execution_end",
          seq: 2,
          time: 35,
          data: { toolCallId: "tool-1" },
        },
      },
      {
        event: {
          type: "message",
          seq: 3,
          time: 40,
          data: { role: "assistant", content: [{ type: "text", text: "done" }] },
        },
      },
    ],
    hasMore: false,
  });

  assert.deepEqual(history.context.entryIds, ["journal-user-1", "pi-event-3"]);
  assert.deepEqual(history.context.entrySeqs, [0, null]);
  assert.deepEqual(history.context.entryCompletedAts, [10, 40]);
  assert.deepEqual(history.context.toolTimings, [
    { toolCallId: "tool-1", startedAt: 20, completedAt: 35 },
  ]);
});

test("restores time to first token from durable stream updates", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message_start",
          seq: 0,
          time: 1_000,
          data: { message: { role: "assistant", content: [], timestamp: 1_000 } },
        },
      },
      {
        event: {
          type: "message_update",
          seq: 1,
          time: 1_250,
          data: { assistantMessageEvent: { type: "text_delta", delta: "H" } },
        },
      },
      {
        event: {
          type: "message_end",
          seq: 2,
          time: 2_000,
          data: {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Hello" }],
              timestamp: 1_000,
            },
          },
        },
      },
    ],
    hasMore: false,
  });

  assert.deepEqual(history.context.entryFirstTokenAts, [1_250]);
  const [message] = piHistoryToThreadMessages(history);
  assert.equal(message?.metadata.timing?.firstTokenTime, 250);
  assert.equal(message?.metadata.custom.piEventSeq, 2);
});

test("materializes an unfinished assistant message from packed durable chunks", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message_start",
          seq: 4,
          time: 1_000,
          entryId: "assistant-start",
          data: {
            message: {
              role: "assistant",
              content: [],
              model: "model-1",
              stopReason: "pending",
              timestamp: 1_000,
            },
          },
        },
      },
      {
        event: {
          type: "message_update",
          seq: 5,
          time: 1_100,
          data: {
            format: "pi-messages-v1",
            streamId: "stream-1",
            firstRevision: 1,
            revision: 4,
            startSeq: 4,
            message: { role: "assistant", model: "model-1", stopReason: "pending" },
            updates: [
              { type: "text_start", contentIndex: 0 },
              { type: "text_delta", contentIndex: 0, delta: "partial" },
              { type: "toolcall_start", contentIndex: 1, id: "tool-1", toolName: "read" },
              { type: "toolcall_delta", contentIndex: 1, delta: '{"path":"/tmp/pa' },
            ],
          },
        },
      },
    ],
    hasMore: false,
  });

  assert.equal(history.context.messages.length, 0);
  assert.deepEqual(history.context.activeAssistant, {
    message: {
      role: "assistant",
      model: "model-1",
      stopReason: "pending",
      timestamp: 1_000,
      content: [
        { type: "text", text: "partial" },
        { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "/tmp/pa" } },
      ],
    },
    entryId: "assistant-start",
    startSeq: 4,
    lastSeq: 5,
    updatedAt: 1_100,
    firstTokenAt: 1_100,
    rawToolArgsText: { "1": '{"path":"/tmp/pa' },
  });
});

test("restores time to first token from compact message completion timing", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message_start",
          seq: 0,
          time: 1_000,
          data: { message: { role: "assistant", content: [], timestamp: 1_000 } },
        },
      },
      {
        event: {
          type: "message_end",
          seq: 1,
          time: 2_000,
          data: {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Hello" }],
              timestamp: 1_000,
            },
            workbenchTiming: { firstTokenAt: 1_250 },
          },
        },
      },
    ],
    hasMore: false,
  });

  assert.deepEqual(history.context.entryFirstTokenAts, [1_250]);
  const [message] = piHistoryToThreadMessages(history);
  assert.equal(message?.metadata.timing?.firstTokenTime, 250);
  assert.equal(message?.metadata.custom.piEventSeq, 1);
});

test("drops failed assistant attempts superseded by automatic retry", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message_end",
          seq: 0,
          time: 10,
          entryId: "user",
          data: { message: { role: "user", content: "hello", timestamp: 10 } },
        },
      },
      {
        event: {
          type: "message_end",
          seq: 1,
          time: 20,
          entryId: "failed-attempt",
          data: {
            message: {
              role: "assistant",
              content: [],
              stopReason: "error",
              errorMessage: "fetch failed",
              timestamp: 20,
            },
          },
        },
      },
      {
        event: {
          type: "auto_retry_start",
          seq: 2,
          time: 30,
          data: { attempt: 2, maxAttempts: 3, delayMs: 1, errorMessage: "fetch failed" },
        },
      },
      {
        event: {
          type: "message_end",
          seq: 3,
          time: 40,
          entryId: "final-attempt",
          data: {
            message: {
              role: "assistant",
              content: [],
              stopReason: "error",
              errorMessage: "fetch failed",
              timestamp: 40,
            },
          },
        },
      },
    ],
    hasMore: false,
  });

  assert.deepEqual(history.context.entryIds, ["user", "final-attempt"]);
  assert.deepEqual(history.context.entrySeqs, [0, 3]);
  assert.deepEqual(history.context.entryCompletedAts, [10, 40]);
  const threadMessages = piHistoryToThreadMessages(history);
  assert.equal(threadMessages.length, 2);
  assert.deepEqual(threadMessages[1]?.status, {
    type: "incomplete",
    reason: "error",
    error: "fetch failed",
  });
});

test("carries the Workbench Composer projection beside the unchanged Pi user message", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message_end",
          seq: 0,
          time: 10,
          data: {
            message: { role: "user", content: "resolved prompt", timestamp: 5 },
            workbenchComposer: {
              version: 1,
              submissionId: "submission-1",
              sourceText: ":pi-command[plan|Plan] inspect",
              hidden: true,
            },
          },
        },
      },
    ],
    hasMore: false,
  });

  assert.deepEqual(history.context.messages, [
    {
      role: "user",
      content: "resolved prompt",
      timestamp: 5,
      workbenchComposer: {
        version: 2,
        submissionId: "submission-1",
        sourceText: ":pi-command[plan|Plan] inspect",
        hidden: true,
      },
    },
  ]);
});

test("projects persisted model changes and successful compactions into the conversation", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message",
          seq: 0,
          time: 10,
          data: {
            role: "assistant",
            provider: "openai",
            model: "gpt-5",
            content: [{ type: "text", text: "first" }],
          },
        },
      },
      {
        event: {
          type: "model_changed",
          seq: 1,
          time: 20,
          data: {
            previousProvider: "openai",
            previousModel: "gpt-5",
            provider: "anthropic",
            model: "claude-sonnet",
          },
        },
      },
      {
        event: {
          type: "compaction_end",
          seq: 2,
          time: 30,
          data: {
            reason: "threshold",
            aborted: false,
            result: { tokensBefore: 120_000, estimatedTokensAfter: 18_000 },
          },
        },
      },
      {
        event: {
          type: "session_forked",
          seq: 3,
          time: 40,
          data: { sourceSessionId: "source-1", sourceEventSeq: 7 },
        },
      },
    ],
    hasMore: false,
  });

  assert.deepEqual(history.context.entryIds, [
    "pi-event-0",
    "pi-event-1:conversation-event",
    "pi-event-2:conversation-event",
    "pi-event-3:conversation-event",
  ]);
  const [message, modelChange, compaction, fork] = history.context.messages;
  assert.equal(message?.role, "assistant");
  assert.equal(modelChange?.role, "custom");
  assert.equal(compaction?.role, "custom");
  assert.equal(fork?.role, "custom");
  if (modelChange?.role !== "custom" || compaction?.role !== "custom" || fork?.role !== "custom") {
    return;
  }
  assert.equal(modelChange.customType, PI_CONVERSATION_EVENT_CUSTOM_TYPE);
  assert.deepEqual(modelChange.details, {
    kind: "model-change",
    provider: "anthropic",
    model: "claude-sonnet",
    previousProvider: "openai",
    previousModel: "gpt-5",
  });
  assert.deepEqual(compaction.details, {
    kind: "compaction",
    reason: "threshold",
    tokensBefore: 120_000,
    estimatedTokensAfter: 18_000,
  });
  assert.deepEqual(fork.details, {
    kind: "fork",
    sourceSessionId: "source-1",
    sourceEventSeq: 7,
  });
  const threadMessages = piHistoryToThreadMessages(history);
  assert.deepEqual(threadMessages.at(-1)?.metadata.custom.piConversationEvent, fork.details);
});

test("derives model boundaries for legacy histories without explicit model events", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message",
          seq: 0,
          time: 10,
          data: {
            role: "assistant",
            provider: "openai",
            model: "gpt-5",
            content: [{ type: "text", text: "first" }],
          },
        },
      },
      {
        event: {
          type: "message",
          seq: 1,
          time: 20,
          data: { role: "user", content: "continue" },
        },
      },
      {
        event: {
          type: "message",
          seq: 2,
          time: 30,
          data: {
            role: "assistant",
            provider: "anthropic",
            model: "claude-sonnet",
            content: [{ type: "text", text: "second" }],
          },
        },
      },
    ],
    hasMore: false,
  });

  assert.deepEqual(history.context.entryIds, [
    "pi-event-0",
    "pi-event-2:derived-model-change",
    "pi-event-1",
    "pi-event-2",
  ]);
  const boundary = history.context.messages[1];
  assert.equal(boundary?.role, "custom");
  if (boundary?.role !== "custom") return;
  assert.deepEqual(boundary.details, {
    kind: "model-change",
    provider: "anthropic",
    model: "claude-sonnet",
    previousProvider: "openai",
    previousModel: "gpt-5",
  });
});

test("builds protocol prompt content for images and PDFs and rejects unsupported media", () => {
  assert.deepEqual(
    piPromptContent(
      "hello",
      [{ type: "image", mimeType: "image/png", data: "AAAA" }],
      [
        {
          type: "file",
          mimeType: "application/pdf",
          data: "JVBERi0=",
          name: "notes.pdf",
        },
      ],
    ),
    [
      { type: "text", text: "hello" },
      { type: "image", mediaType: "image/png", data: "AAAA" },
      {
        type: "file",
        mediaType: "application/pdf",
        data: "JVBERi0=",
        name: "notes.pdf",
      },
    ],
  );
  assert.throws(
    () => piPromptContent("", [{ type: "image", mimeType: "image/bmp", data: "AAAA" }]),
    /Unsupported Pi prompt image type/,
  );
});
