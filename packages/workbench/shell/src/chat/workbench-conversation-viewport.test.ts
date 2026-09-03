import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationViewportAtBottom,
  nextConversationViewportScrollTop,
} from "./workbench-conversation-viewport";

test("native conversation scrolling follows the bottom, respects user lock, and anchors prepends", () => {
  assert.equal(
    conversationViewportAtBottom({ clientHeight: 300, scrollHeight: 900, scrollTop: 598 }),
    true,
  );
  assert.equal(
    conversationViewportAtBottom({ clientHeight: 300, scrollHeight: 900, scrollTop: 597 }),
    false,
  );

  const current = { clientHeight: 300, scrollHeight: 900, scrollTop: 120 };
  assert.equal(
    nextConversationViewportScrollTop({
      current,
      followBottom: true,
      prepended: false,
      previousScrollHeight: 600,
    }),
    600,
  );
  assert.equal(
    nextConversationViewportScrollTop({
      current,
      followBottom: false,
      prepended: false,
      previousScrollHeight: 600,
    }),
    undefined,
  );
  assert.equal(
    nextConversationViewportScrollTop({
      current,
      followBottom: false,
      prepended: true,
      previousScrollHeight: 600,
    }),
    420,
  );
});
