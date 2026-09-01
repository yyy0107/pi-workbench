import assert from "node:assert/strict";
import test from "node:test";

import { MemoryWorkspaceFeedbackStore } from "../right-workspace";

import { createRightWorkspacePromptFeedbackPort } from "./right-workspace-prompt-feedback";

test("explicitly adapts Shell claims without sharing mutable item payloads", () => {
  const feedback = new MemoryWorkspaceFeedbackStore();
  const id = feedback.add({
    surfaceId: "surface-1",
    kind: "diff-line",
    target: { path: "src/app.ts", line: 42 },
    text: "Review this line.",
    scope: { type: "thread", key: "thread-1" },
    threadId: "thread-1",
  });
  const port = createRightWorkspacePromptFeedbackPort(feedback);

  const claim = port.claimForThreads(["thread-1"]);
  assert.ok(claim);
  assert.deepEqual(claim.items, [
    {
      id,
      kind: "diff-line",
      target: { path: "src/app.ts", line: 42 },
      text: "Review this line.",
    },
  ]);
  assert.notEqual(claim.items[0]?.target, feedback.getSnapshot().feedback[0]?.target);
  port.commit(claim.token);
  assert.equal(feedback.getSnapshot().feedback.length, 0);
});

test("release delegates the opaque token and makes feedback claimable again", () => {
  const feedback = new MemoryWorkspaceFeedbackStore();
  feedback.add({
    surfaceId: "surface-1",
    kind: "fixture",
    target: {},
    text: "Retry me.",
    scope: { type: "thread", key: "thread-1" },
    threadId: "thread-1",
  });
  const port = createRightWorkspacePromptFeedbackPort(feedback);
  const claim = port.claimForThreads(["thread-1"]);
  assert.ok(claim);

  port.release(claim.token);
  assert.ok(port.claimForThreads(["thread-1"]));
});

test("late token settlement is teardown-safe after the Shell feedback owner disposes", () => {
  const feedback = new MemoryWorkspaceFeedbackStore();
  feedback.add({
    surfaceId: "surface-1",
    kind: "fixture",
    target: {},
    text: "In flight.",
    scope: { type: "thread", key: "thread-1" },
    threadId: "thread-1",
  });
  const port = createRightWorkspacePromptFeedbackPort(feedback);
  const claim = port.claimForThreads(["thread-1"]);
  assert.ok(claim);
  feedback.dispose();

  assert.doesNotThrow(() => port.commit(claim.token));
  assert.doesNotThrow(() => port.release(claim.token));
  assert.throws(() => port.claimForThreads(["thread-1"]), /disposed/);
});
