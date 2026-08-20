import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationPairKey,
  isLastConversationPair,
  messageRowHasVisibleContent,
  shouldShowWorkingStatus,
} from "./workbench-message-rows";

test("keeps a conversation pair mounted while assistant output is attached", () => {
  const userOnly = [{ id: "user-1", role: "user" as const }];
  const withStreamingAssistant = [
    ...userOnly,
    { id: "assistant-stream", role: "assistant" as const },
  ];
  const withSettledAssistant = [
    ...userOnly,
    { id: "assistant-settled", role: "assistant" as const },
  ];

  assert.equal(conversationPairKey(userOnly[0]!), "user-1");
  assert.equal(conversationPairKey(withStreamingAssistant[0]!), "user-1");
  assert.equal(conversationPairKey(withSettledAssistant[0]!), "user-1");
});

test("distinguishes an empty assistant placeholder from visible streamed output", () => {
  assert.equal(messageRowHasVisibleContent({ content: [{ type: "text", text: "" }] }), false);
  assert.equal(
    messageRowHasVisibleContent({ content: [{ type: "reasoning", text: "thinking" }] }),
    true,
  );
  assert.equal(messageRowHasVisibleContent({ content: [{ type: "tool-call" }] }), true);
});

test("keeps working visible from run start through the assistant placeholder", () => {
  assert.equal(
    shouldShowWorkingStatus({
      isLastPair: true,
      threadIsRunning: true,
      assistantHasVisibleContent: false,
    }),
    true,
  );
  assert.equal(
    shouldShowWorkingStatus({
      isLastPair: true,
      threadIsRunning: false,
      assistantStatus: "running",
      assistantHasVisibleContent: false,
    }),
    true,
  );
  assert.equal(
    shouldShowWorkingStatus({
      isLastPair: true,
      threadIsRunning: true,
      assistantStatus: "running",
      assistantHasVisibleContent: true,
    }),
    false,
  );
});

test("treats trailing system separators as part of the last conversation turn", () => {
  const messages = [
    { id: "user-1", role: "user" as const },
    { id: "assistant-1", role: "assistant" as const },
    { id: "system-1", role: "system" as const },
  ];

  assert.equal(isLastConversationPair(messages, 1), true);
  assert.equal(isLastConversationPair(messages, 0), false);
});
