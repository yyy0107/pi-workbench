import assert from "node:assert/strict";
import test from "node:test";

import { PI_CONVERSATION_EVENT_CUSTOM_TYPE } from "../../contracts";

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
        },
      },
    },
  });

  assert.equal(summary.id, "s-1");
  assert.equal(summary.name, "Protocol migration");
  assert.equal(summary.modified, "1970-01-01T00:00:02.000Z");
  assert.equal(summary.running, true);
  assert.deepEqual(summary.workspace, { id: "w-1", name: "Work", cwd: "/work" });
});

test("adapts canonical message groups and durable tool timing", () => {
  const history = piHistoryFromSessionEvents("s-1", {
    events: [
      {
        event: {
          type: "message_end",
          seq: 0,
          time: 10,
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

  assert.deepEqual(history.context.entryIds, ["pi-event-0", "pi-event-3"]);
  assert.deepEqual(history.context.entryCompletedAts, [10, 40]);
  assert.deepEqual(history.context.toolTimings, [
    { toolCallId: "tool-1", startedAt: 20, completedAt: 35 },
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
    ],
    hasMore: false,
  });

  assert.deepEqual(history.context.entryIds, [
    "pi-event-0",
    "pi-event-1:conversation-event",
    "pi-event-2:conversation-event",
  ]);
  const [message, modelChange, compaction] = history.context.messages;
  assert.equal(message?.role, "assistant");
  assert.equal(modelChange?.role, "custom");
  assert.equal(compaction?.role, "custom");
  if (modelChange?.role !== "custom" || compaction?.role !== "custom") return;
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

test("builds protocol prompt content and rejects unsupported image media", () => {
  assert.deepEqual(
    piPromptContent("hello", [{ type: "image", mimeType: "image/png", data: "AAAA" }]),
    [
      { type: "text", text: "hello" },
      { type: "image", mediaType: "image/png", data: "AAAA" },
    ],
  );
  assert.throws(
    () => piPromptContent("", [{ type: "image", mimeType: "image/bmp", data: "AAAA" }]),
    /Unsupported Pi prompt image type/,
  );
});
