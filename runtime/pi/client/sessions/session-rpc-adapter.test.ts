import assert from "node:assert/strict";
import test from "node:test";

import { PI_CONVERSATION_EVENT_CUSTOM_TYPE } from "@/runtime/pi/contracts/pi";
import { piHistoryToThreadMessages } from "../messages/messages";

import {
  piHistoryFromSessionEvents,
  piPromptContent,
  piSummaryFromSessionListItem,
  WORKBENCH_SESSION_SUMMARY_PROJECTION,
} from "./session-rpc-adapter";

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
          executionOrigin: {
            version: 1,
            origin: "execution",
            workflowId: "workflow-1",
            workflowName: "Daily review",
            workflowKind: "workflow",
            runId: "run-1",
            nodeId: "agent-1",
            attempt: 1,
            source: "schedule",
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
  assert.equal(summary.executionOrigin?.workflowKind, "workflow");
  assert.equal(summary.executionOrigin?.runId, "run-1");
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
