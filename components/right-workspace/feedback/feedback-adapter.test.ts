import assert from "node:assert/strict";
import test from "node:test";

import { appendWorkspaceFeedbackContext, stripWorkspaceFeedbackContext } from "./feedback-adapter";
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
  const feedback = store.forThread(["thread-1"]);
  const prompt = appendWorkspaceFeedbackContext("Please address the comments.", feedback);

  assert.match(prompt, /pi-workbench-workspace-feedback/);
  assert.match(prompt, /"kind":"diff-line"/);
  assert.match(prompt, /"line":42/);
  assert.equal(stripWorkspaceFeedbackContext(prompt), "Please address the comments.");
});

test("feedback claims are isolated by thread and cleared only when committed", () => {
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

  assert.deepEqual(
    store.forThread(["thread-1"]).map((item) => item.id),
    [first],
  );
  store.clear([first]);
  assert.equal(store.forThread(["thread-1"]).length, 0);
  assert.equal(store.forThread(["thread-2"]).length, 1);
});
