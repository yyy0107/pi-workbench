import assert from "node:assert/strict";
import test from "node:test";

import type { AppendMessage } from "@assistant-ui/react";

import { PiMessageQueue } from "./queue";

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

function createQueue(
  steerQueued: ConstructorParameters<typeof PiMessageQueue>[0]["steerQueued"] = async () => {},
  onConsumed: ConstructorParameters<typeof PiMessageQueue>[0]["onConsumed"] = () => {},
) {
  return new PiMessageQueue({
    isRunning: () => true,
    run: async () => {},
    queue: async () => {},
    replace: async () => {},
    steerQueued,
    setPaused: async () => {},
    onConsumed,
    onChange: () => {},
  });
}

test("takes an edited item out of the queue and restores its original position on send", () => {
  const queue = createQueue();
  queue.adapter.enqueue(message("a"));
  queue.adapter.enqueue(message("b"));
  queue.adapter.enqueue(message("c"));

  const editedId = queue.adapter.items[1]!.id;
  const draft = queue.beginEdit(editedId);
  assert.equal(draft?.prompt, "b");
  assert.deepEqual(
    queue.adapter.items.map((item) => item.prompt),
    ["a", "c"],
  );

  queue.reconcile([], ["a", "c", "d"]);
  queue.adapter.enqueue(message("edited b"));

  assert.deepEqual(
    queue.adapter.items.map((item) => item.prompt),
    ["a", "edited b", "c", "d"],
  );
  assert.equal(queue.adapter.items[1]!.id, editedId);
});

test("keeps steer messages out of the visible follow-up queue", () => {
  const queue = createQueue();
  queue.adapter.steer(message("steer"));
  queue.adapter.enqueue(message("follow-up"));

  assert.deepEqual(queue.adapter.steerItems, []);
  assert.deepEqual(
    queue.adapter.items.map((item) => item.prompt),
    ["follow-up"],
  );
});

test("sends adjust-direction immediately to steer and removes it from the visible queue", async () => {
  let dispatched:
    | {
        prompt: string;
        steering: string[];
        followUp: string[];
      }
    | undefined;
  const visibleUserMessages: string[] = [];
  const queue = createQueue(
    async (prompt, steering, followUp) => {
      dispatched = {
        prompt: prompt.message,
        steering: steering.map((item) => item.message),
        followUp: followUp.map((item) => item.message),
      };
    },
    (consumed) => {
      visibleUserMessages.push(
        consumed.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      );
    },
  );
  queue.adapter.enqueue(message("adjust now"));
  queue.adapter.enqueue(message("later"));

  queue.adapter.move(queue.adapter.items[0]!.id, {
    lane: "steer",
    insertAfter: null,
  });

  assert.deepEqual(
    queue.adapter.items.map((item) => item.prompt),
    ["later"],
  );
  assert.deepEqual(queue.adapter.steerItems, []);
  assert.deepEqual(visibleUserMessages, ["adjust now"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatched, {
    prompt: "adjust now",
    steering: [],
    followUp: ["later"],
  });
});

test("restores the follow-up item and removes its optimistic bubble when steer fails", async () => {
  const visibleUserMessages: string[] = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const queue = createQueue(
      async () => {
        throw new Error("steer failed");
      },
      (consumed) => {
        const text = consumed.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        visibleUserMessages.push(text);
        return () => {
          const index = visibleUserMessages.indexOf(text);
          if (index >= 0) visibleUserMessages.splice(index, 1);
        };
      },
    );
    queue.adapter.enqueue(message("adjust now"));

    queue.adapter.move(queue.adapter.items[0]!.id, {
      lane: "steer",
      insertAfter: null,
    });

    assert.deepEqual([...queue.adapter.items], []);
    assert.deepEqual(visibleUserMessages, ["adjust now"]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(
      queue.adapter.items.map((item) => item.prompt),
      ["adjust now"],
    );
    assert.deepEqual(visibleUserMessages, []);
  } finally {
    console.error = originalError;
  }
});

test("restores the previous edit before a different queued item replaces the composer draft", () => {
  const queue = createQueue();
  queue.adapter.enqueue(message("a"));
  queue.adapter.enqueue(message("b"));
  queue.adapter.enqueue(message("c"));

  queue.beginEdit(queue.adapter.items[1]!.id);
  const nextDraft = queue.beginEdit(queue.adapter.items[1]!.id);

  assert.equal(nextDraft?.prompt, "c");
  assert.deepEqual(
    queue.adapter.items.map((item) => item.prompt),
    ["a", "b"],
  );

  queue.adapter.enqueue(message("edited c"));
  assert.deepEqual(
    queue.adapter.items.map((item) => item.prompt),
    ["a", "b", "edited c"],
  );
});
