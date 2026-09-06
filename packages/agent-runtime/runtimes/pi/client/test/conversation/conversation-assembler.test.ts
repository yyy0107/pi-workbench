import assert from "node:assert/strict";
import test from "node:test";

import type { PiAssistantMessage } from "@workbench/agent-runtime-pi-protocol/messages";
import type {
  SessionMessageSnapshotPayload,
  SessionMessageUpdatePayload,
} from "@workbench/agent-runtime-pi-protocol/stream";

import { PiConversationAssembler } from "../../src/conversation/conversation-assembler";
import { conversationNodesFromPiConversation } from "../../src/conversation/conversation-node-projection";
import type {
  PiConversationAssistantMessage as ThreadAssistantMessage,
  PiConversationMessage as ThreadMessage,
} from "../../src/conversation/pi-conversation-message";
import {
  coalesceConsecutiveAssistantMessages,
  piAssistantToThreadMessage,
  piHistoryToThreadMessages,
} from "../../src/messages/messages";
import { PiSessionManager } from "../../src/runtime/manager";
import { piHistoryFromSessionEvents } from "../../src/sessions/session-rpc-projection";
import { SessionMessageAccumulator } from "../../src/transport/session-message-accumulator";
import { longConversation, appendConversationDelta } from "../fixtures/long-conversation";

function user(id: string, text: string): ThreadMessage {
  return {
    id,
    role: "user",
    content: [{ type: "text", text }],
    attachments: [],
    createdAt: new Date(1_725_000_000_000),
    metadata: { custom: {} },
  };
}

function assistant(text: string): ThreadAssistantMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: [
      { type: "text", text, status: { type: "running" } },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "search",
        args: { query: "hello" },
        argsText: '{"query":"hello"}',
      },
    ],
    status: { type: "running" },
    createdAt: new Date(1_725_000_000_001),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
}

function projectedAssistant(event: Record<string, unknown>): ThreadAssistantMessage {
  const message = event.message as PiAssistantMessage;
  return piAssistantToThreadMessage(message, "streamed-assistant", {
    streaming: true,
    rawToolArgsText: event.rawToolArgsText as Readonly<Record<string, string>> | undefined,
  });
}

test("long history bypasses unchanged message projection for composer and streaming updates", () => {
  const assembler = new PiConversationAssembler("long-history");
  const messages = longConversation(1_000);
  let reads = 0;
  for (const message of messages) {
    const content = message.content;
    Object.defineProperty(message, "content", {
      get() {
        reads++;
        return content;
      },
    });
  }
  const branch = { index: 0, count: 2, nextKey: "other" };
  const initial = {
    messages,
    isLoading: false,
    isRunning: true,
    branches: new Map([[messages[0]!.id, branch]]),
  };
  assembler.update(initial);
  const oldUser = assembler.node(messages[0]!.id).getSnapshot();
  const oldAssistant = assembler.node(messages.at(-1)!.id).getSnapshot();
  reads = 0;
  assembler.update({
    ...initial,
    composer: { text: "typing", attachments: [], mode: "send", phase: "idle" },
  });
  assert.equal(reads, 0, "composer changes must not even read historical content");
  assembler.update({
    ...initial,
    messages: [...messages],
    branches: new Map([[messages[0]!.id, { ...branch }]]),
  });
  assert.equal(reads, 0, "equal branch values must not invalidate unchanged messages");

  const updated = appendConversationDelta(messages, "partial");
  reads = 0;
  assembler.update({ ...initial, messages: updated });
  assert.equal(reads, 0, "streaming must not read content from any original message");
  assert.equal(assembler.node(messages[0]!.id).getSnapshot(), oldUser);
  assert.notEqual(assembler.node(messages.at(-1)!.id).getSnapshot(), oldAssistant);
  assembler.update({ ...initial, messages: updated, isRunning: false });
  const final = assembler.node(messages.at(-1)!.id).getSnapshot();
  assert.equal(final?.kind === "assistant" && final.status, "complete");

  assembler.update({
    ...initial,
    messages: updated,
    branches: new Map([[messages[0]!.id, { ...branch, index: 1 }]]),
  });
  assert.equal(assembler.node(messages[0]!.id).getSnapshot()?.presentation?.branch?.index, 1);
  assembler.update({ ...initial, messages: [] });
  assert.equal(assembler.node(messages[0]!.id).getSnapshot(), undefined);
  assembler.update(initial);
  assert.notEqual(
    assembler.node(messages[0]!.id).getSnapshot(),
    oldUser,
    "removed nodes must release their cached projection",
  );
  assembler.dispose();
  assert.equal(assembler.node(messages[0]!.id).getSnapshot(), undefined);
});

test("projects Workbench message chrome metadata and branch navigation", () => {
  const message = assistant("Answer");
  const [node] = conversationNodesFromPiConversation(
    [
      {
        ...message,
        metadata: {
          ...message.metadata,
          isOptimistic: true,
          timing: {
            streamStartTime: 1_725_000_000_001,
            firstTokenTime: 125,
            tokensPerSecond: 42,
            totalChunks: 2,
            toolCallCount: 1,
          },
          custom: {
            workbenchUsage: { input: 10, output: 20 },
            piPrivateValue: "excluded",
          },
        },
      },
    ],
    new Map([
      [message.id, { index: 1, count: 3, previousKey: "previous-head", nextKey: "next-head" }],
    ]),
  );

  assert.deepEqual(node?.presentation, {
    custom: { workbenchUsage: { input: 10, output: 20 } },
    isOptimistic: true,
    timing: {
      streamStartTime: 1_725_000_000_001,
      firstTokenTime: 125,
      tokensPerSecond: 42,
      totalChunks: 2,
      toolCallCount: 1,
    },
    branch: { index: 1, count: 3, previousKey: "previous-head", nextKey: "next-head" },
  });
});

test("preserves native aborts and normalized cancellations through conversation projection", () => {
  for (const stopReason of ["aborted", "error"] as const) {
    const message = piAssistantToThreadMessage(
      {
        role: "assistant",
        content: [],
        stopReason,
        errorMessage: "This operation was aborted",
        ...(stopReason === "error"
          ? {
              diagnostics: [
                {
                  type: "workbench.message-termination.v1",
                  timestamp: 1,
                  details: { schemaVersion: 1, kind: "cancelled", stopReason, source: "workbench" },
                },
              ],
            }
          : {}),
      },
      "stopped",
    );
    const [node] = conversationNodesFromPiConversation([message]);
    assert.equal(node?.kind, "assistant");
    assert.deepEqual(message.status, { type: "incomplete", reason: "cancelled" });
    assert.ok(node?.kind === "assistant");
    assert.equal(node.status, "incomplete");
    assert.equal(
      node.blocks.some((block) => block.kind === "error"),
      false,
    );
    assert.deepEqual(node?.presentation?.custom?.workbenchTermination, {
      schemaVersion: 1,
      kind: stopReason === "aborted" ? "aborted" : "cancelled",
      stopReason,
      ...(stopReason === "aborted"
        ? { errorMessage: "This operation was aborted" }
        : { source: "workbench" }),
    });
  }
});

test("distinguishes cancelled tools from real failures in a stopped response", () => {
  const message = assistant("Partial response");
  const tool = message.content.find((part) => part.type === "tool-call");
  assert.ok(tool?.type === "tool-call");
  const results = ["Operation aborted", { text: "partial output\n\nCommand aborted", details: {} }];
  for (const result of [...results, "Permission denied"]) {
    for (const stopped of [false, true]) {
      const [node] = conversationNodesFromPiConversation([
        {
          ...message,
          content: [{ ...tool, isError: true, result }],
          status: stopped ? { type: "incomplete", reason: "cancelled" } : { type: "running" },
        },
      ]);
      assert.ok(node?.kind === "assistant");
      const block = node.blocks[0];
      assert.ok(block?.kind === "tool-call");
      const cancelled = stopped && result !== "Permission denied";
      assert.equal(block.status, cancelled ? "incomplete" : "error");
      assert.equal(block.incompleteReason, cancelled ? "cancelled" : undefined);
      assert.deepEqual(block.result, result);
    }
  }
});

test("projects image, file, and document source semantics into Workbench blocks", () => {
  const message = {
    id: "assistant-media",
    role: "assistant",
    content: [
      { type: "image", image: "https://example.com/generated", filename: "generated" },
      {
        type: "file",
        data: "file-id",
        filename: "report.pdf",
        mimeType: "application/pdf",
        sourceType: "id",
      },
      {
        type: "source",
        sourceType: "document",
        id: "document-1",
        title: "Architecture",
        filename: "architecture.pdf",
        mediaType: "application/pdf",
      },
      {
        type: "source",
        sourceType: "url",
        id: "url-1",
        title: "Guide",
        url: "https://example.com/guide",
      },
    ],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(1_725_000_000_001),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  } satisfies ThreadAssistantMessage;

  const [node] = conversationNodesFromPiConversation([message]);
  assert.equal(node?.kind, "assistant");
  if (node?.kind !== "assistant") return;
  assert.deepEqual(node.blocks, [
    {
      key: "assistant-media:file:generated",
      kind: "file",
      name: "generated",
      source: "https://example.com/generated",
      mediaType: "image/png",
      sourceType: "url",
    },
    {
      key: "assistant-media:file:report.pdf",
      kind: "file",
      name: "report.pdf",
      source: "file-id",
      mediaType: "application/pdf",
      sourceType: "id",
    },
    {
      key: "assistant-media:source:document-1",
      kind: "source",
      title: "Architecture",
      filename: "architecture.pdf",
      mediaType: "application/pdf",
    },
    {
      key: "assistant-media:source:url-1",
      kind: "source",
      url: "https://example.com/guide",
      title: "Guide",
    },
  ]);
});

test("projects native reasoning and tool timeline state into Workbench blocks", () => {
  const [node] = conversationNodesFromPiConversation([
    {
      id: "assistant-timeline",
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "Plan",
          status: { type: "running" },
          providerMetadata: {
            workbench: { reasoningTiming: { startedAt: 1_000, durationMs: 2_500 } },
          },
        },
        {
          type: "tool-call",
          toolCallId: "running-1",
          toolName: "search",
          args: { query: "partial" },
          argsText: '{"query":"part',
          timing: { startedAt: 4_000 },
          providerMetadata: {
            workbench: { parallelToolBatch: { id: "batch-1", size: 2 } },
          },
        },
        {
          type: "tool-call",
          toolCallId: "complete-1",
          toolName: "read",
          args: { path: "README.md" },
          argsText: '{"path":"README.md"}',
          result: "done",
        },
        {
          type: "tool-call",
          toolCallId: "error-1",
          toolName: "write",
          args: {},
          argsText: "{}",
          result: "denied",
          isError: true,
        },
        {
          type: "tool-call",
          toolCallId: "action-1",
          toolName: "ask_user",
          args: { questions: [] },
          argsText: '{"questions":[]}',
          approval: { id: "approval-1" },
        },
      ],
      status: { type: "running" },
      createdAt: new Date(1_725_000_000_001),
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {},
      },
    },
  ]);

  assert.equal(node?.kind, "assistant");
  if (node?.kind !== "assistant") return;
  assert.deepEqual(node.blocks[0], {
    key: "assistant-timeline:reasoning",
    kind: "reasoning",
    text: "Plan",
    status: "running",
    timing: { startedAt: 1_000, completedAt: 3_500 },
  });
  assert.deepEqual(
    node.blocks.slice(1).map((block) => (block.kind === "tool-call" ? block.status : undefined)),
    ["running", "complete", "error", "requires-action"],
  );
  assert.deepEqual(node.blocks[1], {
    key: "assistant-timeline:tool:running-1",
    kind: "tool-call",
    callId: "running-1",
    toolName: "search",
    arguments: { query: "partial" },
    argumentsText: '{"query":"part',
    status: "running",
    timing: { startedAt: 4_000 },
    parallelGroup: { key: "batch-1", size: 2 },
  });
});

test("assembles equivalent nodes from history replay and live Pi messages", () => {
  const message: PiAssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "Same answer" }],
    stopReason: "stop",
    timestamp: 1_725_000_000_001,
  };
  const history = piHistoryFromSessionEvents("session-1", {
    events: [
      {
        event: {
          type: "message_end",
          seq: 7,
          time: 1_725_000_000_002,
          entryId: "assistant-1",
          data: { message },
        },
      },
    ],
    hasMore: false,
  });
  const replay = new PiConversationAssembler("session-1");
  replay.update({
    messages: piHistoryToThreadMessages(history),
    isLoading: false,
    isRunning: false,
  });
  const live = new PiConversationAssembler("session-1");
  live.update({
    messages: coalesceConsecutiveAssistantMessages([
      piAssistantToThreadMessage(message, "assistant-1", {
        eventSeq: 7,
        timing: {
          streamStartTime: 1_725_000_000_001,
          totalStreamTime: 1,
          totalChunks: 0,
          toolCallCount: 0,
        },
      }),
    ]),
    isLoading: false,
    isRunning: false,
  });

  assert.deepEqual(live.snapshot.getSnapshot(), replay.snapshot.getSnapshot());
  assert.deepEqual(
    live.node("assistant-1").getSnapshot(),
    replay.node("assistant-1").getSnapshot(),
  );
});

test("publishes only changed nodes and preserves stable blocks across replay and deltas", () => {
  const assembler = new PiConversationAssembler("session-1");
  const firstUser = user("user-1", "Hello");
  const firstAssistant = assistant("Searching");
  assembler.update({
    messages: [firstUser, firstAssistant],
    isLoading: false,
    isRunning: true,
  });

  const firstSnapshot = assembler.snapshot.getSnapshot();
  const firstUserNode = assembler.node("user-1").getSnapshot();
  const firstAssistantNode = assembler.node("assistant-1").getSnapshot();
  assert.deepEqual(firstSnapshot.nodeKeys, ["user-1", "assistant-1"]);
  assert.equal(firstAssistantNode?.kind, "assistant");
  if (firstAssistantNode?.kind !== "assistant") return;
  const firstText = firstAssistantNode.blocks[0];
  const firstTool = firstAssistantNode.blocks[1];

  let snapshotNotifications = 0;
  let userNotifications = 0;
  let assistantNotifications = 0;
  assembler.snapshot.subscribe(() => snapshotNotifications++);
  assembler.node("user-1").subscribe(() => userNotifications++);
  assembler.node("assistant-1").subscribe(() => assistantNotifications++);

  assembler.update({
    messages: [user("user-1", "Hello"), assistant("Searching the docs")],
    isLoading: false,
    isRunning: true,
  });

  const deltaSnapshot = assembler.snapshot.getSnapshot();
  const deltaUserNode = assembler.node("user-1").getSnapshot();
  const deltaAssistantNode = assembler.node("assistant-1").getSnapshot();
  assert.equal(deltaSnapshot, firstSnapshot);
  assert.equal(deltaUserNode, firstUserNode);
  assert.notEqual(deltaAssistantNode, firstAssistantNode);
  assert.equal(deltaAssistantNode?.kind, "assistant");
  if (deltaAssistantNode?.kind !== "assistant") return;
  assert.notEqual(deltaAssistantNode.blocks[0], firstText);
  assert.equal(deltaAssistantNode.blocks[1], firstTool);
  assert.deepEqual(
    deltaAssistantNode.blocks.map((block) => block.key),
    ["assistant-1:text", "assistant-1:tool:tool-1"],
  );
  assert.deepEqual(
    { snapshotNotifications, userNotifications, assistantNotifications },
    { snapshotNotifications: 0, userNotifications: 0, assistantNotifications: 1 },
  );

  const replay = new PiConversationAssembler("session-1");
  replay.update({
    messages: [user("user-1", "Hello"), assistant("Searching the docs")],
    isLoading: false,
    isRunning: true,
  });
  assert.deepEqual(replay.snapshot.getSnapshot(), deltaSnapshot);
  assert.deepEqual(replay.node("assistant-1").getSnapshot(), deltaAssistantNode);

  assembler.update({
    messages: [user("user-1", "Hello"), assistant("Searching the docs")],
    isLoading: false,
    isRunning: true,
  });
  assert.equal(assembler.node("assistant-1").getSnapshot(), deltaAssistantNode);
  assert.equal(assistantNotifications, 1);
});

test("lets an immediate terminal update supersede a pending streaming frame", () => {
  const runtimeGlobal = globalThis as unknown as {
    requestAnimationFrame?: (callback: () => void) => number;
  };
  const original = runtimeGlobal.requestAnimationFrame;
  const frames: Array<() => void> = [];
  runtimeGlobal.requestAnimationFrame = (callback) => frames.push(callback);

  try {
    const assembler = new PiConversationAssembler("session-1");
    assembler.update({
      messages: [assistant("Searching")],
      isLoading: false,
      isRunning: true,
    });
    let notifications = 0;
    assembler.node("assistant-1").subscribe(() => notifications++);

    assembler.update(
      {
        messages: [assistant("Done")],
        isLoading: false,
        isRunning: true,
      },
      "animation-frame",
    );
    assert.equal(notifications, 0);
    assert.equal(frames.length, 1);

    assembler.update(
      {
        messages: [assistant("Done")],
        isLoading: false,
        isRunning: false,
      },
      "immediate",
    );
    assert.equal(notifications, 1);
    frames[0]?.();
    assert.equal(notifications, 1);
  } finally {
    if (original) runtimeGlobal.requestAnimationFrame = original;
    else delete runtimeGlobal.requestAnimationFrame;
  }
});

test("keeps partial tool JSON through overlap dedupe and gap snapshot repair", () => {
  const accumulator = new SessionMessageAccumulator();
  const partialJson = '{"query":"hel';
  const snapshot: SessionMessageSnapshotPayload = {
    type: "session/message-snapshot",
    format: "pi-messages-v1",
    sessionId: "session-1",
    streamId: "stream-1",
    startSeq: 10,
    revision: 2,
    time: 1_725_000_000_002,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "tool-1", name: "search", arguments: { query: "hel" } }],
    },
    toolCallJson: { "0": partialJson },
  };
  const first = accumulator.applySnapshot(snapshot);
  assert.equal(first.kind, "event");
  if (first.kind !== "event") return;

  const assembler = new PiConversationAssembler("session-1");
  assembler.update({
    messages: [projectedAssistant(first.event)],
    isLoading: false,
    isRunning: true,
  });
  const firstNode = assembler.node("streamed-assistant").getSnapshot();
  assert.equal(firstNode?.kind, "assistant");
  if (firstNode?.kind !== "assistant") return;
  assert.deepEqual(firstNode.blocks[0], {
    key: "streamed-assistant:tool:tool-1",
    kind: "tool-call",
    callId: "tool-1",
    toolName: "search",
    arguments: { query: "hel" },
    argumentsText: partialJson,
    status: "running",
  });

  assert.equal(accumulator.applySnapshot(snapshot).kind, "ignored");
  const gap: SessionMessageUpdatePayload = {
    type: "session/message-update",
    format: "pi-messages-v1",
    sessionId: "session-1",
    streamId: "stream-1",
    startSeq: 10,
    revision: 4,
    time: 1_725_000_000_004,
    message: { role: "assistant" },
    update: { type: "toolcall_delta", contentIndex: 0, delta: 'lo"}' },
  };
  assert.equal(accumulator.applyUpdate(gap).kind, "gap");
  assert.equal(assembler.node("streamed-assistant").getSnapshot(), firstNode);

  const repaired = accumulator.applySnapshot({
    ...snapshot,
    revision: 4,
    time: gap.time,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "tool-1", name: "search", arguments: { query: "hello" } }],
    },
    toolCallJson: { "0": '{"query":"hello"}' },
  });
  assert.equal(repaired.kind, "event");
  if (repaired.kind !== "event") return;
  assembler.update({
    messages: [projectedAssistant(repaired.event)],
    isLoading: false,
    isRunning: true,
  });
  const repairedNode = assembler.node("streamed-assistant").getSnapshot();
  assert.equal(repairedNode?.key, firstNode.key);
  assert.notEqual(repairedNode, firstNode);
  assert.equal(
    repairedNode?.kind === "assistant" && repairedNode.blocks[0]?.kind === "tool-call"
      ? repairedNode.blocks[0].argumentsText
      : undefined,
    '{"query":"hello"}',
  );
});

test("publishes canonical messages and Workbench nodes from the same PiClientSession", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session");
  const message = user("user-1", "One source");
  const internals = session as unknown as {
    baseMessages: ThreadMessage[];
    publishMessages(): void;
  };
  internals.baseMessages = [message];
  internals.publishMessages();

  assert.equal(session.getSnapshot().messages[0], message);
  assert.deepEqual(session.snapshot.getSnapshot().nodeKeys, ["user-1"]);
  assert.deepEqual(session.node("user-1").getSnapshot(), {
    key: "user-1",
    kind: "user",
    createdAt: 1_725_000_000_000,
    blocks: [{ key: "user-1:text", kind: "text", text: "One source" }],
  });

  manager.dispose();
  assert.deepEqual(session.snapshot.getSnapshot().nodeKeys, []);
  assert.equal(session.node("user-1").getSnapshot(), undefined);
});
