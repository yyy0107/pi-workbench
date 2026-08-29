import assert from "node:assert/strict";
import test from "node:test";

import { truncateConversationTitle } from "./conversation-title";

test("keeps up to 12 Chinese characters in the conversation header", () => {
  assert.equal(truncateConversationTitle("中".repeat(12)), "中".repeat(12));
  assert.equal(truncateConversationTitle("中".repeat(13)), `${"中".repeat(12)}...`);
});

test("keeps up to 24 English characters in the conversation header", () => {
  assert.equal(truncateConversationTitle("a".repeat(24)), "a".repeat(24));
  assert.equal(truncateConversationTitle("a".repeat(25)), `${"a".repeat(24)}...`);
});

test("uses the same display-width budget for mixed-language titles", () => {
  assert.equal(truncateConversationTitle(`${"中".repeat(10)}abcd`), `${"中".repeat(10)}abcd`);
  assert.equal(truncateConversationTitle(`${"中".repeat(10)}abcde`), `${"中".repeat(10)}abcd...`);
});
