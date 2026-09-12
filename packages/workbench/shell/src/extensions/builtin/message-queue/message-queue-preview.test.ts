import assert from "node:assert/strict";
import test from "node:test";

import type { ComposerQueueItem } from "@workbench/agent-runtime-contracts/conversation";

import { visibleComposerQueueItems } from "./message-queue-preview";

function queueItem(key: string): ComposerQueueItem {
  return { key, text: key, attachments: [] };
}

test("shows only the first queued message", () => {
  const first = queueItem("first");
  const visible = visibleComposerQueueItems([first, queueItem("second"), queueItem("third")]);

  assert.deepEqual(visible, [first]);
});

test("keeps an empty queue hidden", () => {
  assert.deepEqual(visibleComposerQueueItems([]), []);
});
