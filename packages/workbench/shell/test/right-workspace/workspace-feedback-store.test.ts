import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryWorkspaceFeedbackStore,
  WorkspaceFeedbackStoreDisposedError,
} from "@workbench/shell/right-workspace";

function addFeedback(store: MemoryWorkspaceFeedbackStore, threadId: string, text: string): string {
  return store.add({
    surfaceId: `surface-${threadId}`,
    kind: "fixture",
    target: { threadId },
    text,
    scope: { type: "thread", key: threadId },
    threadId,
  });
}

test("claims isolate thread aliases and release makes the latest versions retryable", () => {
  const store = new MemoryWorkspaceFeedbackStore();
  const first = addFeedback(store, "thread-1", "first");
  addFeedback(store, "thread-2", "second");

  const claim = store.claimForThreads(["thread-1", "thread-alias"]);
  assert.ok(claim);
  assert.deepEqual(
    claim.items.map((item) => [item.id, item.text, item.target]),
    [[first, "first", { threadId: "thread-1" }]],
  );
  assert.equal(store.claimForThreads(["thread-1"]), undefined);

  store.update(first, { text: "edited while claimed" });
  store.release(claim.token);
  const retry = store.claimForThreads(["thread-1"]);
  assert.ok(retry);
  assert.deepEqual(
    retry.items.map((item) => [item.id, item.text]),
    [[first, "edited while claimed"]],
  );
  assert.equal(store.forThread(["thread-2"]).length, 1);
});

test("commit is an item-version CAS and preserves edits made while a claim is in flight", () => {
  const store = new MemoryWorkspaceFeedbackStore();
  const unchanged = addFeedback(store, "thread-1", "unchanged");
  const edited = addFeedback(store, "thread-1", "original");
  const claim = store.claimForThreads(["thread-1"]);
  assert.ok(claim);

  store.update(edited, { text: "edited" });
  store.commit(claim.token);

  const retry = store.claimForThreads(["thread-1"]);
  assert.ok(retry);
  assert.deepEqual(
    retry.items.map((item) => [item.id, item.text]),
    [[edited, "edited"]],
  );
  assert.equal(
    store.getSnapshot().feedback.some((item) => item.id === unchanged),
    false,
  );
});

test("dispose is idempotent and stale feedback writers fail with one stable error", () => {
  const store = new MemoryWorkspaceFeedbackStore();
  const id = addFeedback(store, "thread-1", "pending");
  const claim = store.claimForThreads(["thread-1"]);
  assert.ok(claim);
  store.dispose();
  store.dispose();

  for (const operation of [
    () => addFeedback(store, "thread-1", "stale"),
    () => store.update(id, { text: "stale" }),
    () => store.remove(id),
    () => store.clearSurface("surface-thread-1"),
    () => store.clear([id]),
    () => store.forContext({ applicationId: "app", threadId: "thread-1" }),
    () => store.forThread(["thread-1"]),
    () => store.claimForThreads(["thread-1"]),
    () => store.subscribe(() => undefined),
  ]) {
    assert.throws(operation, WorkspaceFeedbackStoreDisposedError);
  }
  assert.doesNotThrow(() => store.commit(claim.token));
  assert.doesNotThrow(() => store.release(claim.token));
});
