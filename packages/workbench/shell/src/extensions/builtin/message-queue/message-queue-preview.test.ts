import assert from "node:assert/strict";
import test from "node:test";

import type { ComposerQueueItem } from "@workbench/agent-runtime-contracts/conversation";

import { visibleComposerQueueItems } from "./message-queue-preview";

function queueItem(key: string): ComposerQueueItem {
  return {
    key,
    text: key,
    attachments: [
      {
        key: `${key}-attachment`,
        name: `${key}.png`,
        source: `data:image/png;base64,${key}`,
        mediaType: "image/png",
      },
    ],
  };
}

test("shows every queued message with attachments", () => {
  const queue = [queueItem("first"), queueItem("second"), queueItem("third")];
  const visible = visibleComposerQueueItems(queue);

  assert.deepEqual(visible, queue);
});

test("keeps an empty queue hidden", () => {
  assert.deepEqual(visibleComposerQueueItems([]), []);
});
