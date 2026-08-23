import assert from "node:assert/strict";
import test from "node:test";

import {
  appendWorkspaceFeedbackContext,
  stripWorkspaceFeedbackContext,
} from "@/services/workspace-feedback-service";
import { MemoryWorkspaceFeedbackStore } from "./feedback-store";

test("workspace feedback is structured for Pi while the visible message stays clean", () => {
  const store = new MemoryWorkspaceFeedbackStore();
  store.add({
    surfaceId: "review-1",
    kind: "diff-line",
    target: { path: "src/app.ts", side: "new", line: 42 },
    text: "Return a business error here.",
    scope: { type: "worktree", key: "worktree-1" },
    threadId: "thread-1",
  });
  const claim = store.claimForThreads(["thread-1"]);
  assert.ok(claim);
  const prompt = appendWorkspaceFeedbackContext("Please address the comments.", claim.items);

  assert.match(prompt, /pi-workbench-workspace-feedback/);
  assert.match(prompt, /"kind":"diff-line"/);
  assert.match(prompt, /"line":42/);
  assert.equal(stripWorkspaceFeedbackContext(prompt), "Please address the comments.");
  store.commit(claim.token);
  assert.equal(store.forThread(["thread-1"]).length, 0);
});

test("feedback claims are isolated by thread", () => {
  const store = new MemoryWorkspaceFeedbackStore();
  const first = store.add({
    surfaceId: "artifact-1",
    kind: "artifact-region",
    target: { artifactId: "artifact-1" },
    text: "Adjust this section.",
    scope: { type: "thread", key: "thread-1" },
    threadId: "thread-1",
  });
  store.add({
    surfaceId: "artifact-2",
    kind: "artifact-region",
    target: { artifactId: "artifact-2" },
    text: "Keep this comment pending.",
    scope: { type: "thread", key: "thread-2" },
    threadId: "thread-2",
  });

  const claim = store.claimForThreads(["thread-1"]);
  assert.ok(claim);
  assert.deepEqual(
    claim.items.map((item) => item.id),
    [first],
  );
  store.commit(claim.token);
  assert.equal(store.forThread(["thread-1"]).length, 0);
  assert.equal(store.forThread(["thread-2"]).length, 1);
});

test("committing a delayed claim preserves an edit made while the RPC is in flight", () => {
  const store = new MemoryWorkspaceFeedbackStore();
  const id = store.add({
    surfaceId: "review-1",
    kind: "diff-line",
    target: { path: "src/app.ts", line: 42 },
    text: "Original comment.",
    scope: { type: "thread", key: "thread-1" },
    threadId: "thread-1",
  });

  const inFlight = store.claimForThreads(["thread-1"]);
  assert.ok(inFlight);
  assert.equal(inFlight.items[0]?.text, "Original comment.");

  store.update(id, { text: "Edited while sending." });
  store.commit(inFlight.token);

  const retry = store.claimForThreads(["thread-1"]);
  assert.ok(retry);
  assert.deepEqual(
    retry.items.map((item) => [item.id, item.text]),
    [[id, "Edited while sending."]],
  );
});

test("a claim excludes concurrent pickup and release makes the latest version retryable", () => {
  const store = new MemoryWorkspaceFeedbackStore();
  const id = store.add({
    surfaceId: "review-1",
    kind: "diff-line",
    target: { path: "src/app.ts", line: 42 },
    text: "Retry this comment.",
    scope: { type: "thread", key: "thread-1" },
    threadId: "thread-1",
  });

  const first = store.claimForThreads(["thread-1"]);
  assert.ok(first);
  assert.equal(store.claimForThreads(["thread-1"]), undefined);

  store.release(first.token);
  const retry = store.claimForThreads(["thread-1"]);
  assert.ok(retry);
  assert.deepEqual(
    retry.items.map((item) => item.id),
    [id],
  );
});
