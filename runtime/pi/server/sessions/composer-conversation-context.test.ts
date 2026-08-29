import assert from "node:assert/strict";
import test from "node:test";

import type { PiAgentMessage, PiSessionHistory } from "@/runtime/pi/contracts/pi";
import type { WorkbenchResolvedContext } from "@/runtime/shared/composer/request";

import {
  boundedConversationTranscript,
  resolveConversationReferenceContexts,
} from "./composer-conversation-context";

function history(messages: PiSessionHistory["context"]["messages"]): PiSessionHistory {
  return {
    sessionId: "referenced-session",
    context: {
      messages,
      entryIds: messages.map((_, index) => `entry-${index}`),
      thinkingLevel: "off",
      model: null,
    },
  };
}

function reference(conversationId = "referenced-session"): WorkbenchResolvedContext {
  return {
    source: "workbench.conversation",
    trust: "untrusted-context",
    value: {
      version: 1,
      conversationId,
      title: "Referenced conversation",
    },
  };
}

test("projects only user and assistant text into bounded conversation context", async () => {
  const referencedHistory = history([
    { role: "user", content: "First question" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "First answer" },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tool-1",
      content: [{ type: "text", text: "raw tool output" }],
    },
  ]);
  const [resolved] = await resolveConversationReferenceContexts({
    contexts: [reference()],
    currentConversationId: "current-session",
    getHistory: async () => referencedHistory,
  });

  assert.deepEqual(resolved, {
    source: "workbench.conversation",
    trust: "untrusted-context",
    value: {
      version: 1,
      kind: "conversation-reference",
      conversationId: "referenced-session",
      title: "Referenced conversation",
      status: "available",
      transcript: {
        messages: [
          { role: "user", text: "First question" },
          { role: "assistant", text: "First answer" },
        ],
        truncated: false,
      },
    },
  });
});

test("keeps unavailable and current conversation references explicit without throwing", async () => {
  const ordinary: WorkbenchResolvedContext = {
    source: "file",
    trust: "untrusted-context",
    value: "README.md",
  };
  const resolved = await resolveConversationReferenceContexts({
    contexts: [ordinary, reference("current-session"), reference("missing-session")],
    currentConversationId: "current-session",
    getHistory: async () => {
      throw new Error("missing");
    },
  });

  assert.equal(resolved[0], ordinary);
  assert.deepEqual(
    resolved.slice(1).map((context) => context.value),
    [
      {
        version: 1,
        kind: "conversation-reference",
        conversationId: "current-session",
        title: "Referenced conversation",
        status: "current",
      },
      {
        version: 1,
        kind: "conversation-reference",
        conversationId: "missing-session",
        title: "Referenced conversation",
        status: "unavailable",
      },
    ],
  );
});

test("bounds long referenced histories", () => {
  const transcript = boundedConversationTranscript(
    history(
      Array.from({ length: 80 }, (_, index): PiAgentMessage =>
        index % 2 === 0
          ? {
              role: "user",
              content: `question-${index}-${"x".repeat(2_000)}`,
            }
          : {
              role: "assistant",
              content: [{ type: "text", text: `answer-${index}-${"x".repeat(2_000)}` }],
            },
      ),
    ),
  );

  assert.equal(transcript.truncated, true);
  assert.ok(transcript.messages.length <= 48);
  assert.ok(
    transcript.messages.reduce((total, message) => total + message.text.length, 0) <= 60_000,
  );
});
