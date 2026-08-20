import assert from "node:assert/strict";
import test from "node:test";

import { isLastConversationPair } from "./workbench-message-rows";

test("keeps the last conversational pair anchored across trailing system separators", () => {
  assert.equal(
    isLastConversationPair(
      [{ role: "user" }, { role: "assistant" }, { role: "system" }, { role: "system" }],
      1,
    ),
    true,
  );
});

test("does not anchor a pair when a later conversational message exists", () => {
  assert.equal(
    isLastConversationPair([{ role: "user" }, { role: "system" }, { role: "assistant" }], 0),
    false,
  );
});
