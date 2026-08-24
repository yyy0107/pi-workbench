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
  appendMessageToPiPrompt,
  attachmentRecognitionAssistantMessage,
  coalesceConsecutiveAssistantMessages,
  isAttachmentRecognitionOnlyAssistant,
  optimisticUserMessage,
  piAssistantToThreadMessage,
  piHistoryToThreadMessages,
  piUserMessageContent,
  reconcileLiveMessagesAfterHistory,
} from "./messages";
import {
  WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_RUN_CONFIG_KEY,
  WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
} from "../../../composer-request";
import { conversationEventThreadMessage } from "./conversation-events";
import {
  aggregatePiSessionStatistics,
  mergeMonotonicPiSessionStatistics,
} from "./session-statistics";
import {
  WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE,
  WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME,
} from "../../../image-understanding/state-machine";

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

test("preserves the canonical event sequence used for conversation forks", () => {
  const message = piAssistantToThreadMessage(assistantMessage, "assistant", { eventSeq: 7 });

  assert.equal(message.metadata.custom.piEventSeq, 7);
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

test("projects a sent image attachment into the same message part used by persisted history", () => {
  const message: AppendMessage = {
    role: "user",
    content: [{ type: "text", text: "Describe this" }],
    attachments: [
      {
        id: "attachment-1",
        type: "image",
        name: "layout.png",
        content: [{ type: "image", image: "data:image/png;base64,iVBORw0KGgo=" }],
        status: { type: "complete" },
      },
    ],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };

  const optimistic = optimisticUserMessage(message, "user-live");

  assert.equal(optimistic.role, "user");
  if (optimistic.role !== "user") return;
  assert.deepEqual(optimistic.content, [
    { type: "text", text: "Describe this" },
    {
      type: "image",
      image: "data:image/png;base64,iVBORw0KGgo=",
      filename: "layout.png",
    },
  ]);
  assert.deepEqual(optimistic.attachments, []);
  assert.deepEqual(
    piUserMessageContent([
      { type: "text", text: "Describe this" },
      {
        type: "image",
        data: "iVBORw0KGgo=",
        mimeType: "image/png",
        name: "layout.png",
      },
    ]),
    optimistic.content,
  );
  const [persisted] = piHistoryToThreadMessages({
    sessionId: "session",
    context: {
      entryIds: ["user-persisted"],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image",
              data: "iVBORw0KGgo=",
              mimeType: "image/png",
              name: "layout.png",
            },
          ],
        },
      ],
    },
  });
  assert.equal(persisted?.role, "user");
  if (persisted?.role === "user") {
    assert.deepEqual(persisted.content, optimistic.content);
  }
  assert.deepEqual(appendMessageToPiPrompt(message).images, [
    {
      type: "image",
      data: "iVBORw0KGgo=",
      mimeType: "image/png",
      name: "layout.png",
    },
  ]);
});

test("projects a sent PDF attachment and separates its base64 for the session RPC", () => {
  const pdfBase64 = Buffer.from("%PDF-1.7\nfixture").toString("base64");
  const dataUrl = `data:application/pdf;base64,${pdfBase64}`;
  const message: AppendMessage = {
    role: "user",
    content: [{ type: "text", text: "Read this PDF" }],
    attachments: [
      {
        id: "attachment-pdf",
        type: "document",
        name: "invoice.pdf",
        content: [
          {
            type: "file",
            data: dataUrl,
            mimeType: "application/pdf",
            filename: "invoice.pdf",
          },
        ],
        status: { type: "complete" },
      },
    ],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };

  const optimistic = optimisticUserMessage(message, "user-pdf");
  assert.equal(optimistic.role, "user");
  if (optimistic.role !== "user") return;
  assert.deepEqual(optimistic.content, [
    { type: "text", text: "Read this PDF" },
    {
      type: "file",
      data: dataUrl,
      mimeType: "application/pdf",
      filename: "invoice.pdf",
    },
  ]);
  assert.deepEqual(appendMessageToPiPrompt(message).documents, [
    {
      type: "file",
      data: pdfBase64,
      mimeType: "application/pdf",
      name: "invoice.pdf",
    },
  ]);
});

test("correlates an optimistic image-recognition lifecycle with its prompt RPC", () => {
  const message: AppendMessage = {
    role: "user",
    content: [{ type: "image", image: "data:image/png;base64,iVBORw0KGgo=" }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };

  const optimistic = optimisticUserMessage(message, "user-live", "session.prompt:test");
  assert.equal(optimistic.metadata.custom.workbenchPromptRpcId, "session.prompt:test");
});

test("folds attachment recognition into the assistant message and preserves image and PDF files", () => {
  const pdf = Buffer.from("%PDF-1.7\nfixture").toString("base64");
  const base = {
    version: 1 as const,
    operationId: "recognition-1",
    submissionId: "submission-images",
    rpcId: "session.prompt:images",
    method: "ocr" as const,
    providerId: "glm-ocr",
    attachmentCount: 2,
    timestamps: { createdAt: 1_000, updatedAt: 1_000 },
  };
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["marker", "pending", "running", "success", "resolved-user", "assistant"],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
          content: "",
          display: false,
          details: {
            version: 2,
            submissionId: "submission-images",
            sourceText: "Read this image",
            text: "Read this image",
            document: [{ type: "text", text: "Read this image" }],
            commands: [],
            attachments: [
              { data: "iVBORw0KGgo=", mimeType: "image/png", name: "scan.png" },
              { data: pdf, mimeType: "application/pdf", name: "invoice.pdf" },
            ],
            status: "accepted",
          },
        },
        {
          role: "custom",
          customType: WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE,
          content: "",
          display: true,
          details: { ...base, revision: 0, status: "pending", completedCount: 0, progress: 0 },
        },
        {
          role: "custom",
          customType: WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE,
          content: "",
          display: true,
          details: {
            ...base,
            revision: 1,
            status: "running",
            stage: "recognizing",
            completedCount: 0,
            progress: 0,
            timestamps: { createdAt: 1_000, updatedAt: 1_100 },
          },
        },
        {
          role: "custom",
          customType: WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE,
          content: "",
          display: true,
          details: {
            ...base,
            revision: 2,
            status: "succeeded",
            completedCount: 2,
            progress: 1,
            results: [
              {
                attachmentId: "attachment-1",
                format: "markdown",
                text: "# Recognized invoice\nTotal: 42",
              },
              {
                attachmentId: "attachment-2",
                format: "text",
                text: "PDF reference A-17",
              },
            ],
            timestamps: { createdAt: 1_000, updatedAt: 1_200, completedAt: 1_200 },
          },
        },
        {
          role: "user",
          content: "<workbench-untrusted-context>recognized</workbench-untrusted-context>",
          workbenchComposer: {
            version: 1,
            submissionId: "submission-images",
            sourceText: "Read this image",
            document: [{ type: "text", text: "Read this image" }],
            hidden: true,
          },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "The image contains recognized text." }],
        },
      ],
    },
  };

  const projected = piHistoryToThreadMessages(history);
  assert.equal(projected.length, 2);
  const user = projected[0];
  assert.equal(user?.role, "user");
  if (user?.role !== "user") return;
  assert.equal(user.content.filter((part) => part.type === "image").length, 1);
  assert.equal(user.content.filter((part) => part.type === "file").length, 1);
  assert.equal(
    user.content.some(
      (part) => part.type === "data" && part.name === WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME,
    ),
    false,
  );
  const assistant = projected[1];
  assert.equal(assistant?.role, "assistant");
  if (assistant?.role !== "assistant") return;
  const statePart = assistant.content.find(
    (part) => part.type === "data" && part.name === WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME,
  );
  assert.equal(assistant.content[0], statePart);
  assert.equal(statePart?.type, "data");
  assert.equal(
    statePart?.type === "data" &&
      typeof statePart.data === "object" &&
      statePart.data !== null &&
      "status" in statePart.data
      ? statePart.data.status
      : undefined,
    "succeeded",
  );
  assert.deepEqual(
    statePart?.type === "data" &&
      typeof statePart.data === "object" &&
      statePart.data !== null &&
      "results" in statePart.data
      ? statePart.data.results
      : undefined,
    [
      {
        attachmentId: "attachment-1",
        format: "markdown",
        text: "# Recognized invoice\nTotal: 42",
      },
      {
        attachmentId: "attachment-2",
        format: "text",
        text: "PDF reference A-17",
      },
    ],
  );
});

test("renders token-only Composer source text in its optimistic user bubble", () => {
  const sourceText = ":pi-command[compact|Compact] ";
  const command = {
    id: "command:pi:compact:0",
    commandId: "compact",
    label: "Compact",
    scope: "message" as const,
    source: "pi" as const,
    args: {},
  };
  const message: AppendMessage = {
    role: "user",
    content: [],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: {
      custom: {
        [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: {
          version: 1,
          document: [
            { type: "command", ...command },
            { type: "text", text: " " },
          ],
          sourceText,
          text: "",
          context: [],
          metadata: {},
          commands: [command],
        },
      },
    },
    sourceId: null,
  };

  const optimistic = optimisticUserMessage(message, "user-command");

  assert.deepEqual(optimistic.content, [{ type: "text", text: sourceText }]);
  assert.deepEqual(optimistic.metadata.custom.workbenchComposerDocument, [
    { type: "command", ...command },
    { type: "text", text: " " },
  ]);
});

test("uses the compiled Workbench composer text only at the Pi prompt boundary", () => {
  const prompt = appendMessageToPiPrompt({
    content: [{ type: "text", text: ":workbench-command[plan|Plan] original" }],
    attachments: [],
    runConfig: {
      custom: {
        [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: {
          version: 1,
          sourceText: ":workbench-command[plan|Plan] original",
          text: "compiled prompt",
          context: [],
          metadata: {},
          commands: [],
        },
      },
    },
  });

  assert.equal(prompt.text, "compiled prompt");
  assert.equal(prompt.composer?.sourceText, ":workbench-command[plan|Plan] original");
});

test("keeps panel arguments separate from ordinary text at the Pi prompt boundary", () => {
  const sourceText = ":pi-command[compact|Compact] Continue reviewing tests";
  const command = {
    id: "command:pi:compact:0",
    commandId: "compact",
    label: "Compact",
    scope: "message" as const,
    source: "pi" as const,
    args: { customInstructions: "Focus on concurrency changes" },
  };
  const prompt = appendMessageToPiPrompt({
    content: [{ type: "text", text: sourceText }],
    attachments: [],
    runConfig: {
      custom: {
        [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: {
          version: 1,
          document: [
            { type: "command", ...command },
            { type: "text", text: " Continue reviewing tests" },
          ],
          sourceText,
          text: "Continue reviewing tests",
          context: [],
          metadata: {},
          commands: [command],
        },
      },
    },
  });

  assert.equal(prompt.text, "Continue reviewing tests");
  assert.deepEqual(prompt.composer?.commands[0]?.args, {
    customInstructions: "Focus on concurrency changes",
  });
  assert.equal(prompt.composer?.document?.[1]?.type, "text");
});

test("restores the canonical Composer document, resolution trace, and one projected user bubble", () => {
  const sourceText = ":pi-command[plan|Plan] inspect this";
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["composer", "resolution", "resolved"],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
          content: "",
          display: false,
          details: {
            version: 2,
            submissionId: "submission-1",
            sourceText,
            text: "inspect this",
            document: [
              {
                type: "command",
                id: "command:pi:plan:0",
                commandId: "plan",
                label: "Plan",
                scope: "message",
                source: "pi",
              },
              { type: "text", text: " inspect this" },
            ],
            commands: [
              {
                id: "command:pi:plan:0",
                commandId: "plan",
                label: "Plan",
                scope: "message",
                source: "pi",
              },
            ],
            status: "accepted",
          },
          timestamp: 10,
        },
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
          content: "",
          display: false,
          details: {
            version: 1,
            submissionId: "submission-1",
            status: "resolved",
            commandTrace: [
              {
                source: "pi",
                commandId: "plan",
                label: "Plan",
                scope: "message",
                effect: "instruction",
                status: "success",
              },
            ],
          },
          timestamp: 11,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "<workbench-composer-context>resolved</workbench-composer-context>",
            },
            { type: "image", mimeType: "image/png", data: "image-data" },
          ],
          timestamp: 12,
          workbenchComposer: {
            version: 1,
            submissionId: "submission-1",
            sourceText,
            hidden: true,
          },
        },
      ],
    },
  };

  const converted = piHistoryToThreadMessages(history);

  assert.deepEqual(
    converted.map((message) => message.role),
    ["user"],
  );
  const user = converted[0];
  assert.equal(user?.role, "user");
  if (user?.role !== "user") return;
  assert.deepEqual(user.content, [
    { type: "text", text: sourceText },
    { type: "image", image: "data:image/png;base64,image-data" },
  ]);
  assert.equal(user.metadata.custom.workbenchComposerSubmissionId, "submission-1");
  assert.equal(user.metadata.custom.workbenchComposerStatus, "resolved");
  assert.deepEqual(user.metadata.custom.workbenchComposerCommandTrace, [
    {
      source: "pi",
      commandId: "plan",
      label: "Plan",
      scope: "message",
      effect: "instruction",
      status: "success",
    },
  ]);
  assert.deepEqual(user.metadata.custom.workbenchComposerDocument, [
    {
      type: "command",
      id: "command:pi:plan:0",
      commandId: "plan",
      label: "Plan",
      scope: "message",
      source: "pi",
    },
    { type: "text", text: " inspect this" },
  ]);
  assert.equal(user.metadata.custom.piResolvedEntryId, "resolved");
});

test("places a resolved follow-up Composer message after the assistant turn it waited for", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: [
        "initial-user",
        "follow-up-composer",
        "follow-up-resolution",
        "initial-assistant",
        "follow-up-user",
        "follow-up-assistant",
      ],
      thinkingLevel: "off",
      model: null,
      messages: [
        { role: "user", content: "需要", timestamp: 10 },
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
          content: "",
          display: false,
          details: {
            version: 2,
            submissionId: "submission-follow-up",
            sourceText: "你",
            text: "你",
            document: [{ type: "text", text: "你" }],
            commands: [],
            status: "accepted",
          },
          timestamp: 20,
        },
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
          content: "",
          display: false,
          details: {
            version: 1,
            submissionId: "submission-follow-up",
            status: "resolved",
            commandTrace: [],
          },
          timestamp: 21,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "上一条回答" }],
          timestamp: 30,
        },
        {
          role: "user",
          content: "你",
          timestamp: 40,
          workbenchComposer: {
            version: 1,
            submissionId: "submission-follow-up",
            sourceText: "你",
            document: [{ type: "text", text: "你" }],
            hidden: true,
          },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "follow-up 回答" }],
          timestamp: 50,
        },
      ],
    },
  };

  const converted = piHistoryToThreadMessages(history);

  assert.deepEqual(
    converted.map((message) => [
      message.role,
      message.content[0]?.type === "text" ? message.content[0].text : undefined,
    ]),
    [
      ["user", "需要"],
      ["assistant", "上一条回答"],
      ["user", "你"],
      ["assistant", "follow-up 回答"],
    ],
  );
  assert.equal(converted[2]?.id, "follow-up-composer");
  assert.equal(converted[2]?.createdAt.getTime(), 40);
  assert.equal(converted[2]?.metadata.custom.piResolvedEntryId, "follow-up-user");
});

test("uses the projected token source when a partial history page omits the Composer marker", () => {
  const sourceText = ":pi-command[compact|Compact] keep decisions continue";
  const document = [
    {
      type: "command" as const,
      id: "command:pi:compact:0",
      commandId: "compact",
      label: "Compact",
      scope: "message" as const,
      source: "pi" as const,
      args: { customInstructions: "keep decisions" },
    },
    {
      type: "command-argument" as const,
      id: "argument:command:pi:compact:0:customInstructions",
      commandNodeId: "command:pi:compact:0",
      field: "customInstructions",
      text: " keep decisions",
    },
    { type: "text" as const, text: " continue" },
  ];
  const [message] = piHistoryToThreadMessages({
    sessionId: "session",
    context: {
      entryIds: ["resolved"],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "user",
          content: "<workbench-composer-context>resolved</workbench-composer-context>",
          workbenchComposer: {
            version: 1,
            submissionId: "submission-2",
            sourceText,
            document,
            hidden: true,
          },
        },
      ],
    },
  });

  assert.equal(message?.role, "user");
  if (message?.role !== "user") return;
  assert.deepEqual(message.content, [{ type: "text", text: sourceText }]);
  assert.deepEqual(message.metadata.custom.workbenchComposerDocument, document);
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
      entrySeqs: [0, 2, null, 4, null],
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
  assert.equal(assistant.metadata.custom.piEventSeq, 4);
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

test("preserves every LLM step for session-level statistics after coalescing", () => {
  const user: ThreadMessage = {
    id: "user",
    role: "user",
    content: [{ type: "text", text: "Inspect it" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: { custom: {} },
  };
  const first = piAssistantToThreadMessage(
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "tool", name: "read", arguments: {} }],
      usage: {
        input: 100,
        output: 20,
        cacheRead: 900,
        cacheWrite: 10,
        totalTokens: 1_030,
      },
    },
    "first",
    {
      timing: {
        streamStartTime: 2_000,
        firstTokenTime: 400,
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
      content: [{ type: "text", text: "Done" }],
      usage: {
        input: 50,
        output: 30,
        cacheRead: 1_050,
        cacheWrite: 0,
        totalTokens: 1_130,
      },
    },
    "final",
    {
      timing: {
        streamStartTime: 11_000,
        firstTokenTime: 600,
        totalStreamTime: 2_000,
        totalChunks: 3,
        toolCallCount: 0,
      },
    },
  );

  const messages = coalesceConsecutiveAssistantMessages([user, first, final]);

  assert.deepEqual(aggregatePiSessionStatistics(messages), {
    turns: 1,
    steps: 2,
    llmDurationMs: 3_000,
    toolDurationMs: 7_000,
    firstTokenDurationMs: 1_000,
    firstTokenSamples: 2,
    inputTokens: 150,
    outputTokens: 50,
    cacheReadTokens: 1_950,
    cacheWriteTokens: 10,
  });
});

test("updates the active LLM step in session statistics before message completion", () => {
  const user: ThreadMessage = {
    id: "user",
    role: "user",
    content: [{ type: "text", text: "Keep streaming" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: { custom: {} },
  };
  const completed = piAssistantToThreadMessage(
    {
      role: "assistant",
      content: [{ type: "text", text: "First step" }],
      usage: {
        input: 100,
        output: 20,
        cacheRead: 500,
        cacheWrite: 0,
        totalTokens: 620,
      },
    },
    "completed",
    {
      timing: {
        streamStartTime: 2_000,
        firstTokenTime: 200,
        totalStreamTime: 1_000,
        totalChunks: 2,
        toolCallCount: 0,
      },
    },
  );
  const streaming = piAssistantToThreadMessage(
    {
      role: "assistant",
      content: [{ type: "text", text: "Still going" }],
      usage: {
        input: 50,
        output: 10,
        cacheRead: 650,
        cacheWrite: 5,
        totalTokens: 715,
      },
    },
    "streaming",
    {
      streaming: true,
      timing: {
        streamStartTime: 5_000,
        firstTokenTime: 300,
        totalChunks: 3,
        toolCallCount: 0,
      },
    },
  );

  const messages = coalesceConsecutiveAssistantMessages([user, completed, streaming]);

  assert.deepEqual(aggregatePiSessionStatistics(messages, 6_500), {
    turns: 1,
    steps: 2,
    llmDurationMs: 2_500,
    toolDurationMs: 0,
    firstTokenDurationMs: 500,
    firstTokenSamples: 2,
    inputTokens: 150,
    outputTokens: 30,
    cacheReadTokens: 1_150,
    cacheWriteTokens: 5,
  });
});

test("updates active tool duration before the tool call completes", () => {
  const user: ThreadMessage = {
    id: "user",
    role: "user",
    content: [{ type: "text", text: "Read it" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: { custom: {} },
  };
  const assistant = piAssistantToThreadMessage(
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "tool", name: "read", arguments: {} }],
    },
    "assistant",
    {
      timing: {
        streamStartTime: 2_000,
        totalStreamTime: 1_000,
        totalChunks: 2,
        toolCallCount: 1,
      },
      toolTimingById: new Map([["tool", { startedAt: 3_000 }]]),
    },
  );

  const messages = coalesceConsecutiveAssistantMessages([user, assistant]);

  assert.equal(aggregatePiSessionStatistics(messages, 5_400).toolDurationMs, 2_400);
});

test("keeps session cumulative quantities monotonic across transient projections", () => {
  const previous = {
    turns: 3,
    steps: 5,
    llmDurationMs: 5_000,
    toolDurationMs: 4_000,
    firstTokenDurationMs: 900,
    firstTokenSamples: 3,
    inputTokens: 1_000,
    outputTokens: 300,
    cacheReadTokens: 2_000,
    cacheWriteTokens: 100,
  };
  const transient = {
    turns: 2,
    steps: 4,
    llmDurationMs: 4_500,
    toolDurationMs: 3_500,
    firstTokenDurationMs: 700,
    firstTokenSamples: 2,
    inputTokens: 900,
    outputTokens: 250,
    cacheReadTokens: 1_800,
    cacheWriteTokens: 80,
  };

  assert.deepEqual(mergeMonotonicPiSessionStatistics(previous, transient), previous);
  assert.equal(
    mergeMonotonicPiSessionStatistics(previous, {
      ...transient,
      outputTokens: 320,
    }).outputTokens,
    320,
  );
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

test("projects a persisted built-in command outcome as a system response", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["response"],
      entryCompletedAts: [6_000],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
          content: "",
          display: true,
          details: {
            version: 1,
            submissionId: "submission-1",
            source: "pi",
            commandId: "reload",
            label: "Reload",
            status: "success",
          },
        },
      ],
    },
  };

  const [message] = piHistoryToThreadMessages(history);
  assert.equal(message?.role, "system");
  assert.equal(message?.createdAt.getTime(), 6_000);
  assert.deepEqual(message?.metadata.custom.workbenchComposerCommandResponse, {
    version: 1,
    submissionId: "submission-1",
    source: "pi",
    commandId: "reload",
    label: "Reload",
    status: "success",
  });
});

test("merges a successful compact response into its existing compaction event", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["compaction", "response"],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "custom",
          customType: PI_CONVERSATION_EVENT_CUSTOM_TYPE,
          content: "",
          display: true,
          details: { kind: "compaction", reason: "manual", tokensBefore: 42_000 },
        },
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
          content: "",
          display: true,
          details: {
            version: 1,
            submissionId: "submission-compact",
            source: "pi",
            commandId: "compact",
            label: "Compact",
            status: "success",
          },
        },
      ],
    },
  };

  const messages = piHistoryToThreadMessages(history);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]?.metadata.custom.workbenchComposerCommandResponse, {
    version: 1,
    submissionId: "submission-compact",
    source: "pi",
    commandId: "compact",
    label: "Compact",
    status: "success",
  });
});

test("reduces the compact command lifecycle to one final system message", () => {
  const history: PiSessionHistory = {
    sessionId: "session",
    context: {
      entryIds: ["running", "compaction", "success"],
      entryCompletedAts: [1_000, 2_000, 3_000],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
          content: "",
          display: true,
          details: {
            version: 1,
            submissionId: "submission-state-machine",
            source: "pi",
            commandId: "compact",
            label: "Compact",
            status: "running",
          },
        },
        {
          role: "custom",
          customType: PI_CONVERSATION_EVENT_CUSTOM_TYPE,
          content: "",
          display: true,
          details: { kind: "compaction", reason: "manual", tokensBefore: 42_000 },
        },
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
          content: "",
          display: true,
          details: {
            version: 1,
            submissionId: "submission-state-machine",
            source: "pi",
            commandId: "compact",
            label: "Compact",
            status: "success",
          },
        },
      ],
    },
  };

  const messages = piHistoryToThreadMessages(history);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "workbench-command-response:submission-state-machine:compact");
  assert.equal(messages[0]?.createdAt.getTime(), 1_000);
  assert.equal(
    (
      messages[0]?.metadata.custom.workbenchComposerCommandResponse as
        | { status?: string }
        | undefined
    )?.status,
    "success",
  );
  assert.equal(messages[0]?.metadata.custom.piConversationEvent, undefined);
});

test("reduces a failed command lifecycle to one final error message", () => {
  const base = {
    version: 1 as const,
    submissionId: "submission-error",
    source: "pi" as const,
    commandId: "compact",
    label: "Compact",
  };
  const messages = piHistoryToThreadMessages({
    sessionId: "session",
    context: {
      entryIds: ["running", "failed"],
      thinkingLevel: "off",
      model: null,
      messages: [
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
          content: "",
          display: true,
          details: { ...base, status: "running" },
        },
        {
          role: "custom",
          customType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
          content: "",
          display: true,
          details: { ...base, status: "execution-failed" },
        },
      ],
    },
  });

  assert.equal(messages.length, 1);
  assert.equal(
    (
      messages[0]?.metadata.custom.workbenchComposerCommandResponse as
        | { status?: string }
        | undefined
    )?.status,
    "execution-failed",
  );
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

test("keeps one attachment-recognition step when consecutive retry fragments are coalesced", () => {
  const failedRecognition = (operationId: string, updatedAt: number) =>
    attachmentRecognitionAssistantMessage({
      version: 1,
      operationId,
      submissionId: "submission-image-retry",
      revision: 2,
      status: "failed",
      method: "ocr",
      providerId: "paddleocr",
      attachmentCount: 1,
      completedCount: 0,
      errorCode: "provider-invalid-response",
      timestamps: { createdAt: updatedAt - 2, updatedAt, completedAt: updatedAt },
    });
  const final = piAssistantToThreadMessage(
    { role: "assistant", content: [{ type: "text", text: "Unable to read the attachment." }] },
    "assistant-final",
  );

  const [merged] = coalesceConsecutiveAssistantMessages([
    failedRecognition("recognition-1", 1_002),
    failedRecognition("recognition-2", 2_002),
    failedRecognition("recognition-3", 3_002),
    final,
  ]);

  assert.equal(merged?.role, "assistant");
  if (merged?.role !== "assistant") return;
  const recognitionParts = merged.content.filter(
    (part) => part.type === "data" && part.name === WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME,
  );
  assert.equal(recognitionParts.length, 1);
  assert.equal(
    recognitionParts[0]?.type === "data" &&
      typeof recognitionParts[0].data === "object" &&
      recognitionParts[0].data !== null &&
      "operationId" in recognitionParts[0].data
      ? recognitionParts[0].data.operationId
      : undefined,
    "recognition-3",
  );
  assert.equal(
    merged.content.some(
      (part) => part.type === "text" && part.text === "Unable to read the attachment.",
    ),
    true,
  );
  assert.equal(isAttachmentRecognitionOnlyAssistant(merged), false);
  assert.equal(merged.metadata.custom.workbenchImageRecognition, undefined);
  assert.equal(merged.metadata.custom.workbenchImageRecognitionOnly, undefined);
  assert.ok(merged.metadata.custom.workbenchAttachmentRecognition);
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
