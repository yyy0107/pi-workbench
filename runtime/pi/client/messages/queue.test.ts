import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type { AppendMessage } from "@assistant-ui/react";

import type { QueueItem } from "../../stream-contracts";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { PiMessageQueue } = (await import(
  new URL("./queue.ts", import.meta.url).href
)) as typeof import("./queue");
moduleHooks.deregister();

function message(text: string): AppendMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };
}

function queued(id: string, text: string, placement: QueueItem["placement"] = "queued"): QueueItem {
  return {
    id,
    placement,
    message: {
      id,
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    },
  };
}

function harness() {
  const calls: unknown[] = [];
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async (value) => {
      calls.push(["run", value]);
    },
    enqueue: async (mode, prompt) => {
      calls.push(["enqueue", mode, prompt]);
    },
    update: async (id, action) => {
      calls.push(["update", id, action]);
    },
    setPaused: async (paused, steering, followUp) => {
      calls.push(["paused", paused, steering, followUp]);
    },
    onChange: () => {},
  });
  return { queue, calls };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("waits for the authoritative snapshot instead of minting a local queue id", async () => {
  const { queue, calls } = harness();
  queue.adapter.enqueue(message("later"));
  assert.equal(queue.adapter.items.length, 0);
  await flush();
  assert.deepEqual(calls, [["enqueue", "followUp", { message: "later" }]]);

  queue.replaceAuthoritative([queued("host-id", "later")]);
  assert.deepEqual(
    queue.adapter.items.map((item) => [item.id, item.prompt]),
    [["host-id", "later"]],
  );
});

test("edits, removes, and steers using the stable host item id", async () => {
  const { queue, calls } = harness();
  queue.replaceAuthoritative([queued("queue-1", "one"), queued("queue-2", "two")]);

  const draft = queue.beginEdit("queue-1");
  assert.equal(draft?.prompt, "one");
  assert.deepEqual(
    queue.adapter.items.map((item) => item.id),
    ["queue-2"],
  );
  queue.adapter.enqueue(message("edited"));
  queue.adapter.remove("queue-2");
  queue.adapter.move("queue-2", { lane: "steer", insertAfter: null });
  await flush();

  assert.deepEqual(calls, [
    ["update", "queue-1", { kind: "edit", content: [{ type: "text", text: "edited" }] }],
    ["update", "queue-2", { kind: "remove" }],
    ["update", "queue-2", { kind: "steer" }],
  ]);
});

test("maps queued and steering content while leaving context outside the composer queue", () => {
  const { queue } = harness();
  queue.replaceAuthoritative([
    queued("queued", "later"),
    queued("steering", "now", "steering"),
    queued("context", "system context", "context"),
    {
      id: "image",
      placement: "queued",
      message: {
        id: "image",
        role: "user",
        content: [{ type: "image", mediaType: "image/png", data: "payload" }],
        source: { kind: "user" },
      },
    },
  ]);

  assert.deepEqual(
    queue.adapter.items.map((item) => [item.id, item.prompt]),
    [
      ["queued", "later"],
      ["image", "[image]"],
    ],
  );
  assert.deepEqual(
    queue.adapter.steerItems.map((item) => [item.id, item.prompt]),
    [["steering", "now"]],
  );
  assert.deepEqual(queue.adapter.items[1]?.parts, [
    { type: "file", data: "payload", mimeType: "image/png" },
  ]);
});
