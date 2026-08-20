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

test("projects complete text and image messages without losing full content on Pi text snapshots", () => {
  const queue = new SessionQueueProjection({ createId: ids() });
  queue.append("followUp", {
    message: "look",
    images: [{ type: "image", mimeType: "image/png", data: "base64-data" }],
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
          { type: "image", mediaType: "image/png", data: "base64-data" },
        ],
        source: { kind: "user" },
      },
    },
  ]);
});
