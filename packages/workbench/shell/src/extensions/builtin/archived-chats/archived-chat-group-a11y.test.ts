import assert from "node:assert/strict";
import test from "node:test";

import { archivedChatGroupHeadingId } from "./archived-chat-group-a11y";

test("scopes equal archived-chat group IDs to their component installation", () => {
  const first = archivedChatGroupHeadingId(":r1:", "shared/workspace");
  const second = archivedChatGroupHeadingId(":r2:", "shared/workspace");

  assert.notEqual(first, second);
  assert.equal(first, ":r1:-archived-chat-group-shared%2Fworkspace");
  assert.equal(second, ":r2:-archived-chat-group-shared%2Fworkspace");
  assert.equal(archivedChatGroupHeadingId(":r1:", "shared/workspace"), first);
});
