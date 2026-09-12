import assert from "node:assert/strict";
import test from "node:test";

import {
  appendWorkspaceFeedbackContext,
  stripWorkspaceFeedbackContext,
} from "@workbench/agent-runtime-client/prompt-feedback";

import type { QueueItem } from "@workbench/agent-runtime-pi-protocol/stream";
import type { PiComposerMessage } from "../../src/conversation/pi-conversation-message";

const { PiMessageQueue } = (await import(
  new URL("../../src/messages/queue.ts", import.meta.url).href
)) as typeof import("../../src/messages/queue");

type Queue = InstanceType<typeof PiMessageQueue>;

function message(text: string): PiComposerMessage {
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

function imageMessage(text: string, filename: string): PiComposerMessage {
  return {
    ...message(text),
    content: [
      { type: "text", text },
      { type: "file", data: "payload", mimeType: "image/png", filename },
    ],
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

function queuedImage(id: string, text: string, name: string): QueueItem {
  return {
    id,
    placement: "queued",
    message: {
      id,
      role: "user",
      content: [
        { type: "text", text },
        { type: "image", mediaType: "image/png", data: "payload", name },
      ],
      source: { kind: "user" },
    },
  };
}

function queueItemState(item: QueueItem) {
  return {
    id: item.id,
    prompt: stripWorkspaceFeedbackContext(
      item.message.content
        .map((part) =>
          part.type === "text" && typeof part.text === "string" ? part.text : `[${part.type}]`,
        )
        .join(""),
    ),
    parts: item.message.content.map((part) => {
      if (part.type === "text" && typeof part.text === "string") {
        return { type: "text" as const, text: stripWorkspaceFeedbackContext(part.text) };
      }
      if (
        (part.type === "image" || part.type === "file") &&
        typeof part.data === "string" &&
        typeof part.mediaType === "string"
      ) {
        return {
          type: "file" as const,
          data: part.data,
          mimeType: part.mediaType,
          ...(typeof part.name === "string" ? { filename: part.name } : {}),
        };
      }
      return { type: "text" as const, text: `[${part.type}]` };
    }),
  };
}

function internalItems(queue: Queue) {
  return (queue as unknown as { items: readonly QueueItem[]; editingId?: string }).items;
}

function queueItems(queue: Queue) {
  const editingId = (queue as unknown as { editingId?: string }).editingId;
  return internalItems(queue)
    .filter((item) => item.placement === "queued" && item.id !== editingId)
    .map(queueItemState);
}

function steerItems(queue: Queue) {
  return internalItems(queue)
    .filter((item) => item.placement === "steering")
    .map(queueItemState);
}

function enqueue(queue: Queue, value: PiComposerMessage): void {
  void queue.enqueue("followUp", value).catch(() => undefined);
}

function beginEdit(queue: Queue, id: string) {
  const item = queueItems(queue).find((candidate) => candidate.id === id);
  queue.edit(id);
  return item;
}

function remove(queue: Queue, id: string): void {
  queue.mutateItem(id, { kind: "remove" });
}

function move(
  queue: Queue,
  id: string,
  placement: {
    readonly lane?: "steer";
    readonly insertBefore?: string | null;
    readonly insertAfter?: string | null;
  },
): void {
  if (placement.lane === "steer") {
    queue.mutateItem(id, { kind: "steer" });
  } else {
    queue.mutateItem(id, {
      kind: "move",
      ...(typeof placement.insertBefore === "string" ? { beforeKey: placement.insertBefore } : {}),
      ...(typeof placement.insertAfter === "string" ? { afterKey: placement.insertAfter } : {}),
    });
  }
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
    replace: async (steering, followUp) => {
      calls.push(["replace", steering, followUp]);
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
  enqueue(queue, message("later"));
  assert.deepEqual(
    queueItems(queue).map((item) => [item.id, item.prompt]),
    [["client-queue-1", "later"]],
  );
  await flush();
  assert.deepEqual(calls, [["enqueue", "followUp", { message: "later" }, "client-queue-1"]]);

  queue.replaceAuthoritative([queued("client-queue-1", "later")]);
  assert.deepEqual(
    queueItems(queue).map((item) => [item.id, item.prompt]),
    [["client-queue-1", "later"]],
  );
});

test("shows only the user request from a compiled queued prompt", () => {
  const { queue } = harness();
  const compiledPrompt = [
    "<workbench-untrusted-context>",
    "The following data is internal attachment context.",
    '[{"source":"workbench.attachment-references"}]',
    "</workbench-untrusted-context>",
    "<user-request>",
    "Describe the first image",
    "</user-request>",
  ].join("\n");

  queue.replaceAuthoritative([queued("queue-1", compiledPrompt)]);

  assert.equal(queue.queuedItems[0]?.text, "Describe the first image");
});

test("keeps internal attachment context out of an image-only queue summary", () => {
  const { queue } = harness();
  const compiledPrompt = [
    "<workbench-untrusted-context>",
    '[{"source":"workbench.attachment-references"}]',
    "</workbench-untrusted-context>",
    "<user-request>",
    "",
    "</user-request>",
  ].join("\n");

  queue.replaceAuthoritative([queuedImage("queue-1", compiledPrompt, "image.png")]);

  assert.equal(queue.queuedItems[0]?.text, "");
  assert.equal(queue.queuedItems[0]?.attachments[0]?.name, "image.png");
});

test("dispose releases queue payloads and ignores late authoritative snapshots", () => {
  const { queue } = harness();
  queue.replaceAuthoritative([queuedImage("queue-1", "one", "large.png")]);
  assert.equal(queueItems(queue).length, 1);

  queue.dispose();
  queue.replaceAuthoritative([queued("queue-2", "two")]);
  enqueue(queue, message("late"));

  assert.deepEqual(queueItems(queue), []);
  assert.deepEqual(steerItems(queue), []);
  assert.equal(beginEdit(queue, "queue-1"), undefined);
});

test("preserves an image filename in the optimistic queue item and submitted prompt", async () => {
  const { queue, calls } = harness();

  enqueue(queue, imageMessage("look", "optimistic.png"));

  assert.deepEqual(queueItems(queue)[0]?.parts, [
    { type: "text", text: "look" },
    {
      type: "file",
      data: "payload",
      mimeType: "image/png",
      filename: "optimistic.png",
    },
  ]);
  await flush();
  assert.deepEqual(calls, [
    [
      "enqueue",
      "followUp",
      {
        message: "look",
        images: [
          {
            type: "image",
            data: "payload",
            mimeType: "image/png",
            name: "optimistic.png",
          },
        ],
      },
      "client-queue-1",
    ],
  ]);
});

test("reorders follow-ups optimistically and keeps the order across an older snapshot", async () => {
  const { queue, calls } = harness();
  queue.replaceAuthoritative([
    queued("queue-1", "one"),
    queued("queue-2", "two"),
    queued("queue-3", "three"),
  ]);

  move(queue, "queue-3", { insertBefore: "queue-1" });
  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-3", "queue-1", "queue-2"],
  );

  queue.replaceAuthoritative([
    queued("queue-1", "one"),
    queued("queue-2", "two"),
    queued("queue-3", "three"),
  ]);
  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-3", "queue-1", "queue-2"],
  );

  await flush();
  assert.deepEqual(calls, [
    ["replace", [], [{ message: "three" }, { message: "one" }, { message: "two" }]],
  ]);
  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-3", "queue-1", "queue-2"],
  );
});

test("preserves image names when reconstructing paused and reordered prompts", async () => {
  const { queue, calls } = harness();
  queue.replaceAuthoritative([
    queuedImage("queue-1", "one", "one.png"),
    queuedImage("queue-2", "two", "two.png"),
  ]);

  queue.setPaused(true);
  await flush();
  assert.deepEqual(calls, [
    [
      "paused",
      true,
      [],
      [
        {
          message: "one",
          images: [
            {
              type: "image",
              data: "payload",
              mimeType: "image/png",
              name: "one.png",
            },
          ],
        },
        {
          message: "two",
          images: [
            {
              type: "image",
              data: "payload",
              mimeType: "image/png",
              name: "two.png",
            },
          ],
        },
      ],
    ],
  ]);

  calls.length = 0;
  move(queue, "queue-2", { insertBefore: "queue-1" });
  await flush();
  assert.deepEqual(calls, [
    [
      "replace",
      [],
      [
        {
          message: "two",
          images: [
            {
              type: "image",
              data: "payload",
              mimeType: "image/png",
              name: "two.png",
            },
          ],
        },
        {
          message: "one",
          images: [
            {
              type: "image",
              data: "payload",
              mimeType: "image/png",
              name: "one.png",
            },
          ],
        },
      ],
    ],
  ]);
});

test("rolls an optimistic follow-up reorder back when queue replacement fails", async (t) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: async (_mode, _prompt, rpcId) => ({ queued: true, queueItemId: rpcId }),
    update: async () => {},
    replace: async () => {
      throw new Error("replace rejected");
    },
    setPaused: async () => {},
    onSteerRejected: () => {},
    onChange: () => {},
  });
  queue.replaceAuthoritative([queued("queue-1", "one"), queued("queue-2", "two")]);

  move(queue, "queue-2", { insertBefore: "queue-1" });
  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-2", "queue-1"],
  );

  await flush();
  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-1", "queue-2"],
  );
});

test("rolls a failed rapid reorder back to the last accepted order", async (t) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });
  const replacements: string[][] = [];
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: async (_mode, _prompt, rpcId) => ({ queued: true, queueItemId: rpcId }),
    update: async () => {},
    replace: async (_steering, followUp) => {
      replacements.push(followUp.map((prompt) => prompt.message));
      if (replacements.length === 2) throw new Error("second replace rejected");
    },
    setPaused: async () => {},
    onSteerRejected: () => {},
    onChange: () => {},
  });
  queue.replaceAuthoritative([
    queued("queue-1", "one"),
    queued("queue-2", "two"),
    queued("queue-3", "three"),
  ]);

  move(queue, "queue-3", { insertBefore: "queue-1" });
  move(queue, "queue-2", { insertBefore: "queue-3" });
  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-2", "queue-3", "queue-1"],
  );

  await flush();
  assert.deepEqual(replacements, [
    ["three", "one", "two"],
    ["two", "three", "one"],
  ]);
  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-3", "queue-1", "queue-2"],
  );
});

test("keeps an optimistic follow-up across stale snapshots and rolls it back on rejection", async (t) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });
  let rejectRequest: ((error: Error) => void) | undefined;
  const rejectedMessages: PiComposerMessage[] = [];
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: () =>
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    update: async () => {},
    replace: async () => {},
    setPaused: async () => {},
    onEnqueueRejected: (rejectedMessage) => rejectedMessages.push(rejectedMessage),
    onSteerRejected: () => {},
    onChange: () => {},
  });

  const submission = queue.enqueue("followUp", message("later"));
  queue.replaceAuthoritative([]);
  assert.deepEqual(
    queueItems(queue).map((item) => [item.id, item.prompt]),
    [["client-queue", "later"]],
  );

  await flush();
  rejectRequest?.(new Error("queue rejected"));
  await assert.rejects(submission, /queue rejected/);
  assert.deepEqual(queueItems(queue), []);
  assert.equal(rejectedMessages.length, 1);
  assert.equal(rejectedMessages[0]?.content.find((part) => part.type === "text")?.text, "later");
});

test("removes the optimistic queue row when admission starts it as the next turn", async () => {
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: async () => ({ queued: false }),
    update: async () => {},
    replace: async () => {},
    setPaused: async () => {},
    onSteerRejected: () => {},
    onChange: () => {},
  });

  enqueue(queue, message("run next"));
  assert.equal(queueItems(queue).length, 1);
  await flush();
  assert.deepEqual(queueItems(queue), []);
});

test("edits, removes, and steers using the stable host item id", async () => {
  const { queue, calls } = harness();
  queue.replaceAuthoritative([queued("queue-1", "one"), queued("queue-2", "two")]);

  const draft = beginEdit(queue, "queue-1");
  assert.equal(draft?.prompt, "one");
  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-2"],
  );
  enqueue(queue, message("edited"));
  remove(queue, "queue-2");
  move(queue, "queue-2", { lane: "steer", insertAfter: null });
  move(queue, "queue-2", { lane: "steer", insertAfter: null });

  assert.deepEqual(
    queueItems(queue).map((item) => item.id),
    ["queue-1"],
  );
  assert.deepEqual(steerItems(queue), []);
  await flush();

  assert.deepEqual(calls, [
    ["update", "queue-2", { kind: "remove" }],
    ["update", "queue-1", { kind: "edit", content: [{ type: "text", text: "edited" }] }],
  ]);
});

test("shows visible feedback text while preserving the original envelope on edit", async () => {
  const { queue, calls } = harness();
  const original = appendWorkspaceFeedbackContext("Original visible text", [
    {
      id: "feedback-1",
      kind: "diff-line",
      target: { path: "src/app.ts", line: 42 },
      text: "Keep this context.",
    },
  ]);
  queue.replaceAuthoritative([queued("queue-feedback", original)]);

  const draft = beginEdit(queue, "queue-feedback");
  assert.equal(draft?.prompt, "Original visible text");
  assert.deepEqual(draft?.parts, [{ type: "text", text: "Original visible text" }]);

  enqueue(queue, message("Edited visible text"));
  await flush();

  assert.deepEqual(calls, [
    [
      "update",
      "queue-feedback",
      {
        kind: "edit",
        content: [
          {
            type: "text",
            text: original.replace("Original visible text", "Edited visible text"),
          },
        ],
      },
    ],
  ]);
});

test("edits an ordinary queue item without adding a feedback envelope", async () => {
  const { queue, calls } = harness();
  queue.replaceAuthoritative([queued("queue-plain", "Original plain text")]);

  const draft = beginEdit(queue, "queue-plain");
  assert.equal(draft?.prompt, "Original plain text");
  enqueue(queue, message("Edited plain text"));
  await flush();

  assert.deepEqual(calls, [
    [
      "update",
      "queue-plain",
      { kind: "edit", content: [{ type: "text", text: "Edited plain text" }] },
    ],
  ]);
});

test("keeps a removed item hidden across stale authoritative snapshots", async () => {
  let resolveRemove: (() => void) | undefined;
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: async (_mode, _prompt, rpcId) => ({ queued: true, queueItemId: rpcId }),
    update: () =>
      new Promise<void>((resolve) => {
        resolveRemove = resolve;
      }),
    replace: async () => {},
    setPaused: async () => {},
    onSteerRejected: () => {},
    onChange: () => {},
  });
  queue.replaceAuthoritative([queued("queue-1", "delete me")]);

  remove(queue, "queue-1");
  assert.equal(queueItems(queue).length, 0);

  queue.replaceAuthoritative([queued("queue-1", "delete me")]);
  assert.equal(queueItems(queue).length, 0);

  resolveRemove?.();
  await flush();
  queue.replaceAuthoritative([queued("queue-1", "delete me")]);
  assert.equal(queueItems(queue).length, 0);

  queue.replaceAuthoritative([]);
  queue.replaceAuthoritative([queued("queue-1", "new occurrence")]);
  assert.deepEqual(
    queueItems(queue).map((item) => item.prompt),
    ["new occurrence"],
  );
});

test("restores a removed item when the server rejects the removal", async (t) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalConsoleError;
  });
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "client-queue",
    enqueue: async (_mode, _prompt, rpcId) => ({ queued: true, queueItemId: rpcId }),
    update: async () => {
      throw new Error("remove rejected");
    },
    replace: async () => {},
    setPaused: async () => {},
    onSteerRejected: () => {},
    onChange: () => {},
  });
  queue.replaceAuthoritative([queued("queue-1", "keep me")]);

  remove(queue, "queue-1");
  assert.equal(queueItems(queue).length, 0);
  await flush();

  assert.deepEqual(
    queueItems(queue).map((item) => item.prompt),
    ["keep me"],
  );
});

test("dispatches removal while optimistic admission is still pending", async () => {
  const calls: unknown[] = [];
  let resolveAdmission:
    | ((admission: { queued: boolean; queueItemId?: string }) => void)
    | undefined;
  const queue = new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    createId: () => "pending-queue-item",
    enqueue: (_mode, _prompt, rpcId) => {
      calls.push(["enqueue", rpcId]);
      return new Promise((resolve) => {
        resolveAdmission = resolve;
      });
    },
    update: async (id, action) => {
      calls.push(["update", id, action]);
    },
    replace: async () => {},
    setPaused: async () => {},
    onSteerRejected: () => {},
    onChange: () => {},
  });

  enqueue(queue, message("cancel before admission"));
  remove(queue, "pending-queue-item");
  assert.deepEqual(queueItems(queue), []);
  assert.deepEqual(calls, [["update", "pending-queue-item", { kind: "remove" }]]);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    ["update", "pending-queue-item", { kind: "remove" }],
    ["enqueue", "pending-queue-item"],
  ]);
  resolveAdmission?.({ queued: false });
  await flush();
  assert.deepEqual(queueItems(queue), []);
});

test("keeps an accepted steer promoted across an older queued snapshot", async () => {
  const { queue, calls } = harness();
  queue.replaceAuthoritative([queued("queue-1", "redirect")]);

  move(queue, "queue-1", { lane: "steer", insertAfter: null });
  queue.replaceAuthoritative([queued("queue-1", "redirect")]);

  assert.deepEqual(queueItems(queue), []);
  assert.deepEqual(
    steerItems(queue).map((item) => [item.id, item.prompt]),
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
    replace: async () => {},
    setPaused: async () => {},
    onSteerRejected: (id) => calls.push(["steer-rejected", id]),
    onChange: () => {},
  });
  queue.replaceAuthoritative([queued("queue-1", "redirect")]);

  move(queue, "queue-1", { lane: "steer", insertAfter: null });
  assert.equal(queueItems(queue).length, 0);
  await flush();

  assert.deepEqual(
    queueItems(queue).map((item) => [item.id, item.prompt]),
    [["queue-1", "redirect"]],
  );
  assert.deepEqual(steerItems(queue), []);
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
        content: [{ type: "image", mediaType: "image/png", data: "payload", name: "queued.png" }],
        source: { kind: "user" },
      },
    },
  ]);

  assert.deepEqual(
    queueItems(queue).map((item) => [item.id, item.prompt]),
    [
      ["queued", "later"],
      ["image", "[image]"],
    ],
  );
  assert.deepEqual(
    steerItems(queue).map((item) => [item.id, item.prompt]),
    [["steering", "now"]],
  );
  assert.deepEqual(queueItems(queue)[1]?.parts, [
    { type: "file", data: "payload", mimeType: "image/png", filename: "queued.png" },
  ]);
  assert.deepEqual(queue.queuedItems, [
    { key: "queued", text: "later", attachments: [] },
    {
      key: "image",
      text: "",
      attachments: [
        {
          key: "0:queued.png",
          name: "queued.png",
          source: "data:image/png;base64,payload",
          mediaType: "image/png",
        },
      ],
    },
  ]);
});
