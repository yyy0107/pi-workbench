import assert from "node:assert/strict";
import test from "node:test";

import { openPromotedSideChatConversation } from "./side-chat-navigation";

test("promotes a scratch side chat through the semantic Shell navigation port", () => {
  const opened: string[] = [];

  openPromotedSideChatConversation(
    { openConversation: (conversationId) => void opened.push(conversationId) },
    "promoted-session",
  );

  assert.deepEqual(opened, ["promoted-session"]);
});
