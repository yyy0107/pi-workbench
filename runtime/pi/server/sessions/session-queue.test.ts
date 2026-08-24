import assert from "node:assert/strict";
import test from "node:test";

const { SessionQueueProjection } = (await import(
  new URL("./session-queue.ts", import.meta.url).href
)) as typeof import("./session-queue");

function ids() {
  let value = 0;
  return () => `queue-${++value}`;
}

test("preserves occurrence ids across snapshots, edits, lane moves, and duplicate values", () => {
  const queue = new SessionQueueProjection({ createId: ids() });
  queue.reconcile([], [{ message: "same" }, { message: "same" }, { message: "later" }]);
  const initial = queue.items();
  assert.deepEqual(
    initial.map((item) => item.id),
    ["queue-1", "queue-2", "queue-3"],
  );

  queue.reconcile([], [{ message: "same" }, { message: "later" }]);
  assert.deepEqual(
    queue.items().map((item) => item.id),
    ["queue-1", "queue-3"],
  );

  assert.equal(queue.edit("queue-3", { message: "edited" }), true);
  queue.reconcile([], [{ message: "same" }, { message: "edited" }]);
  assert.equal(queue.items()[1]?.id, "queue-3");

  queue.moveToSteering("queue-1");
  assert.deepEqual(
    queue.items().map((item) => [item.id, item.placement]),
    [
      ["queue-3", "queued"],
      ["queue-1", "steering"],
    ],
  );
});

test("projects complete text and attachment messages without losing full content on Pi text snapshots", () => {
  const queue = new SessionQueueProjection({ createId: ids() });
  queue.append("followUp", {
    message: "look",
    images: [{ type: "image", mimeType: "image/png", data: "base64-data", name: "diagram.png" }],
    documents: [
      {
        type: "file",
        mimeType: "application/pdf",
        data: "pdf-data",
        name: "spec.pdf",
      },
    ],
  });
  queue.reconcile([], [{ message: "look" }]);

  assert.deepEqual(queue.items(), [
    {
      id: "queue-1",
      placement: "queued",
      message: {
        id: "queue-1",
        role: "user",
        content: [
          { type: "text", text: "look" },
          {
            type: "image",
            mediaType: "image/png",
            data: "base64-data",
            name: "diagram.png",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            data: "pdf-data",
            name: "spec.pdf",
          },
        ],
        source: { kind: "user" },
      },
    },
  ]);
});

test("uses image names to reconcile otherwise identical queued prompts", () => {
  const queue = new SessionQueueProjection({ createId: ids() });
  const first = {
    message: "look",
    images: [
      { type: "image" as const, mimeType: "image/png", data: "same-data", name: "first.png" },
    ],
  };
  const second = {
    message: "look",
    images: [
      { type: "image" as const, mimeType: "image/png", data: "same-data", name: "second.png" },
    ],
  };
  queue.reconcile([], [first, second]);

  queue.reconcile([], [second, first]);

  assert.deepEqual(
    queue.items().map((item) => [item.id, item.message.content[1]?.name]),
    [
      ["queue-2", "second.png"],
      ["queue-1", "first.png"],
    ],
  );
});

test("uses the prompt RPC id as the stable queue id when it is available", () => {
  const queue = new SessionQueueProjection({ createId: ids() });
  const item = queue.append("followUp", { message: "later" }, "session.prompt:client-1");

  assert.equal(item.id, "session.prompt:client-1");
  assert.equal(queue.items()[0]?.id, "session.prompt:client-1");
});
