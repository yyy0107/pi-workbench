import assert from "node:assert/strict";
import test from "node:test";

import { createI18n, defineMessage, resolveText } from "@/i18n";

import {
  nextSideChatSequence,
  sideChatResourceKey,
  sideChatSurfaceTitle,
  SIDE_CHAT_SURFACE_KIND,
  type SideChatSurfaceParams,
} from "./side-chat-workspace";

function params(scratchSessionId: string, sequence = 1): SideChatSurfaceParams {
  return {
    scratchSessionId,
    sourceSessionId: "source-1",
    expiresAt: 1,
    sequence,
  };
}

test("side chats from the same source thread remain independent scratch resources", () => {
  assert.notEqual(
    sideChatResourceKey(params("scratch-1")),
    sideChatResourceKey(params("scratch-2")),
  );
});

test("revealing the same scratch side chat reuses its resource", () => {
  assert.equal(sideChatResourceKey(params("scratch-1")), sideChatResourceKey(params("scratch-1")));
});

test("assigns the next stable sequence within the same source thread", () => {
  const surfaces = [
    { kind: SIDE_CHAT_SURFACE_KIND, params: params("scratch-1", 1) },
    { kind: SIDE_CHAT_SURFACE_KIND, params: params("scratch-3", 3) },
    {
      kind: SIDE_CHAT_SURFACE_KIND,
      params: { ...params("other", 9), sourceSessionId: "source-2" },
    },
    { kind: "file", params: { sequence: 20, sourceSessionId: "source-1" } },
  ];

  assert.equal(nextSideChatSequence(surfaces, "source-1"), 4);
  assert.equal(nextSideChatSequence(surfaces, "source-2"), 10);
  assert.equal(nextSideChatSequence([], "source-1"), 1);
});

test("renders the sequence after the localized side-chat title", () => {
  const title = sideChatSurfaceTitle(2);

  assert.equal(resolveText(createI18n("en-US").t, title), "Temporary chat (2)");
  assert.equal(resolveText(createI18n("zh-CN").t, title), "临时侧聊 (2)");
});

test("keeps legacy unnumbered side-chat title descriptors resolvable", () => {
  const title = defineMessage("extensions.sideChat.title");

  assert.equal(resolveText(createI18n("en-US").t, title), "Temporary chat");
  assert.equal(resolveText(createI18n("zh-CN").t, title), "临时侧聊");
});
