import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeAgentRuntime,
  createFakeConversationSession,
} from "@workbench/agent-runtime-testkit/runtime";

test("FakeConversationSession advances keyed nodes independently from its snapshot", () => {
  const session = createFakeConversationSession("session-1");
  const userNode = {
    kind: "user" as const,
    key: "turn:1",
    blocks: [{ kind: "text" as const, key: "turn:1:text:0", text: "hello" }],
  };
  const source = session.node(userNode.key);
  let nodeNotifications = 0;
  source.subscribe(() => {
    nodeNotifications += 1;
  });

  session.setNode(userNode);

  assert.strictEqual(session.node(userNode.key), source);
  assert.strictEqual(source.getSnapshot(), userNode);
  assert.deepEqual(session.snapshot.getSnapshot().nodeKeys, [userNode.key]);
  assert.equal(nodeNotifications, 1);

  session.patchSnapshot({ isRunning: true });
  assert.equal(session.snapshot.getSnapshot().isRunning, true);
  assert.strictEqual(source.getSnapshot(), userNode);
});

test("FakeAgentRuntime creates, selects, and clears Sessions without React or Pi", async () => {
  const runtime = createFakeAgentRuntime();
  let currentNotifications = 0;
  runtime.current.subscribe(() => {
    currentNotifications += 1;
  });

  const id = await runtime.createThread({ workspaceId: "workspace-1" });

  assert.ok(runtime.session(id));
  assert.deepEqual(runtime.current.getSnapshot(), { sessionId: id, isNewThread: false });
  assert.equal(runtime.threads.getSnapshot().threads[0]?.workspace?.id, "workspace-1");

  runtime.switchToNewThread();
  assert.deepEqual(runtime.current.getSnapshot(), { sessionId: undefined, isNewThread: true });
  assert.equal(currentNotifications, 2);
});
