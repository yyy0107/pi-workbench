import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationIdFromDesktopUrl,
  desktopConversationIdForLaunch,
  desktopUrlForConversation,
} from "../src/navigation/desktop-routes";

test("projects conversation identity into one static document URL", () => {
  const conversationUrl = desktopUrlForConversation(
    "workbench://app/index.html?retained=yes",
    "thread/你好",
  );
  assert.equal(
    conversationUrl,
    "workbench://app/index.html?retained=yes&conversation=thread%2F%E4%BD%A0%E5%A5%BD",
  );
  assert.equal(conversationIdFromDesktopUrl(conversationUrl), "thread/你好");
  assert.equal(
    desktopUrlForConversation(conversationUrl, undefined),
    "workbench://app/index.html?retained=yes",
  );
});

test("restores the selected conversation unless the launch URL is explicit", () => {
  assert.equal(
    desktopConversationIdForLaunch("workbench://app/index.html", "persisted-thread"),
    "persisted-thread",
  );
  assert.equal(
    desktopConversationIdForLaunch(
      "workbench://app/index.html?conversation=url-thread",
      "persisted-thread",
    ),
    "url-thread",
  );
});

test("fails closed for invalid, empty, or unbounded conversation URLs", () => {
  assert.equal(conversationIdFromDesktopUrl("not a URL"), undefined);
  assert.equal(conversationIdFromDesktopUrl("workbench://app/?conversation="), undefined);
  assert.equal(
    conversationIdFromDesktopUrl(`workbench://app/?conversation=${"a".repeat(4_097)}`),
    undefined,
  );
});
