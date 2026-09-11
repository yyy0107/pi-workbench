import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationNode } from "@workbench/agent-runtime-contracts/conversation";
import { createConversationNodeSelection } from "../src/runtime/node-selection";

test("node selections cache unchanged fields, follow missing/reordered nodes, and release subscriptions", () => {
  function source(key: string) {
    let value: ConversationNode | undefined = { key, kind: "user", blocks: [] };
    const listeners = new Set<() => void>();
    return {
      listeners,
      getSnapshot: () => value,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      set(next: ConversationNode | undefined) {
        value = next;
        for (const listener of listeners) listener();
      },
    };
  }
  const first = source("first");
  const second = source("second");
  let selections = 0;
  const select = (node: ConversationNode) => {
    selections++;
    return { key: node.key, kind: node.kind };
  };
  const same = (a: ReturnType<typeof select>, b: ReturnType<typeof select>) =>
    a.key === b.key && a.kind === b.kind;
  const collection = createConversationNodeSelection([first, second], select, same);
  let notifications = 0;
  const unsubscribe = collection.subscribe(() => {
    notifications++;
  });
  const initial = collection.getSnapshot();
  assert.equal(selections, 2);
  assert.equal(collection.getSnapshot(), initial);
  assert.equal(selections, 2);

  second.set({
    key: "second",
    kind: "user",
    blocks: [{ key: "text", kind: "text", text: "delta" }],
  });
  assert.equal(collection.getSnapshot(), initial, "unselected text does not change the collection");
  assert.equal(selections, 3, "only the changed source is selected again");
  second.set({ key: "second", kind: "system", blocks: [] });
  const changed = collection.getSnapshot();
  assert.notEqual(changed, initial);
  assert.equal(changed[0], initial[0]);
  assert.equal(changed[1]?.kind, "system");

  first.set(undefined);
  assert.deepEqual(
    collection.getSnapshot().map((node) => node.key),
    ["second"],
  );
  first.set({ key: "first", kind: "user", blocks: [] });
  assert.deepEqual(
    collection.getSnapshot().map((node) => node.key),
    ["first", "second"],
  );
  const reordered = createConversationNodeSelection([second, first], (node) => node.key);
  assert.deepEqual(reordered.getSnapshot(), ["second", "first"]);
  const complete = createConversationNodeSelection([second], (node) => node);
  assert.equal(complete.getSnapshot()[0], second.getSnapshot());

  unsubscribe();
  assert.equal(first.listeners.size + second.listeners.size, 0);
  assert.equal(notifications, 4);
  // A pull between render and subscribe must also observe unpublished-to-this-listener changes.
  second.set({ key: "second", kind: "user", blocks: [] });
  assert.equal(collection.getSnapshot()[1]?.kind, "user");
});
