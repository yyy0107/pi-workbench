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
  let nextId = 0;
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async (value) => {
      calls.push(["run", value]);
    },
    createId: () => `client-queue-${++nextId}`,
    enqueue: async (mode, prompt, rpcId) => {
      calls.push(["enqueue", mode, prompt, rpcId]);
      return { queued: true, queueItemId: rpcId };
    },
    update: async (id, action) => {
      calls.push(["update", id, action]);
    },
    setPaused: async (paused, steering, followUp) => {
      calls.push(["paused", paused, steering, followUp]);
    },
    onSteerRejected: (id) => {
      calls.push(["steer-rejected", id]);
    },
    onChange: () => {},
  });
  return { queue, calls };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("publishes a follow-up immediately and lets the authoritative snapshot adopt its id", async () => {
  const { queue, calls } = harness();
  queue.adapter.enqueue(message("later"));
  assert.deepEqual(
    queue.adapter.items.map((item) => [item.id, item.prompt]),
    [["client-queue-1", "later"]],
  );
  await flush();
  assert.deepEqual(calls, [["enqueue", "followUp", { message: "later" }, "client-queue-1"]]);

  queue.replaceAuthoritative([queued("client-queue-1", "later")]);
  assert.deepEqual(
    queue.adapter.items.map((item) => [item.id, item.prompt]),
    [["client-queue-1", "later"]],
  );
});

test("keeps an optimistic follow-up across stale snapshots and rolls it back on rejection", async (t) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });
  let rejectRequest: ((error: Error) => void) | undefined;
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: () =>
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    update: async () => {},
    setPaused: async () => {},
    onSteerRejected: () => {},
    onChange: () => {},
  });

  queue.adapter.enqueue(message("later"));
  queue.replaceAuthoritative([]);
  assert.deepEqual(
    queue.adapter.items.map((item) => [item.id, item.prompt]),
    [["client-queue", "later"]],
  );

  await flush();
  rejectRequest?.(new Error("queue rejected"));
  await flush();
  assert.deepEqual(queue.adapter.items, []);
});

test("removes the optimistic queue row when admission starts it as the next turn", async () => {
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: async () => ({ queued: false }),
    update: async () => {},
    setPaused: async () => {},
    onSteerRejected: () => {},
    onChange: () => {},
  });

  queue.adapter.enqueue(message("run next"));
  assert.equal(queue.adapter.items.length, 1);
  await flush();
  assert.deepEqual(queue.adapter.items, []);
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
  queue.adapter.move("queue-2", { lane: "steer", insertAfter: null });

  assert.deepEqual(
    queue.adapter.items.map((item) => item.id),
    ["queue-1"],
  );
  assert.deepEqual(
    queue.adapter.steerItems.map((item) => item.id),
    ["queue-2"],
  );
  await flush();

  assert.deepEqual(calls, [
    ["update", "queue-1", { kind: "edit", content: [{ type: "text", text: "edited" }] }],
    ["update", "queue-2", { kind: "remove" }],
    ["update", "queue-2", { kind: "steer" }],
  ]);
});

test("keeps an accepted steer promoted across an older queued snapshot", async () => {
  const { queue, calls } = harness();
  queue.replaceAuthoritative([queued("queue-1", "redirect")]);

  queue.adapter.move("queue-1", { lane: "steer", insertAfter: null });
  queue.replaceAuthoritative([queued("queue-1", "redirect")]);

  assert.deepEqual(queue.adapter.items, []);
  assert.deepEqual(
    queue.adapter.steerItems.map((item) => [item.id, item.prompt]),
    [["queue-1", "redirect"]],
  );
  await flush();
  assert.deepEqual(calls, [["update", "queue-1", { kind: "steer" }]]);
});

test("restores the queued row when steer is rejected", async (t) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });
  const calls: unknown[] = [];
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: async (_mode, _prompt, rpcId) => ({ queued: true, queueItemId: rpcId }),
    update: async () => {
      throw new Error("steer rejected");
    },
    setPaused: async () => {},
    onSteerRejected: (id) => calls.push(["steer-rejected", id]),
    onChange: () => {},
  });
  queue.replaceAuthoritative([queued("queue-1", "redirect")]);

  queue.adapter.move("queue-1", { lane: "steer", insertAfter: null });
  assert.equal(queue.adapter.items.length, 0);
  await flush();

  assert.deepEqual(
    queue.adapter.items.map((item) => [item.id, item.prompt]),
    [["queue-1", "redirect"]],
  );
  assert.deepEqual(queue.adapter.steerItems, []);
  assert.deepEqual(calls, [["steer-rejected", "queue-1"]]);
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
