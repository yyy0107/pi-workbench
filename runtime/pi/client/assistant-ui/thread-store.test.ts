import assert from "node:assert/strict";
import test from "node:test";

import type { PiSessionManager, PiThreadStateSnapshot } from "../runtime/manager";
import { createPiAgentThreadStore, projectPiAgentThreadSnapshot } from "./thread-store";

type ThreadStoreManager = Pick<
  PiSessionManager,
  | "getThreadRevision"
  | "getThreadStateSnapshot"
  | "subscribeThread"
  | "setThreadPinned"
  | "moveWorkspaceSessionBefore"
>;

const lastMessageAt = new Date("2026-08-25T23:45:00.000Z");
const executionOrigin = {
  version: 1,
  origin: "execution",
  workflowId: "workflow-1",
  workflowName: "Daily review",
  workflowKind: "workflow",
  runId: "run-1",
  nodeId: "agent-1",
  attempt: 1,
  source: "schedule",
} as const;

const automationOrigin = {
  version: 1,
  origin: "automation",
  automationId: "automation-1",
  automationName: "Morning briefing",
  source: "schedule",
  triggeredAt: 1_777_000_000_000,
} as const;

function nativeSnapshot(): PiThreadStateSnapshot {
  return {
    thread: {
      remoteId: "session-1",
      status: "regular",
      title: "Projected title",
      lastMessageAt,
    },
    metadata: {
      running: true,
      waitingForUserInput: true,
      completed: true,
      pinned: true,
      createdAt: "2026-08-25T23:00:00.000Z",
      workspace: {
        id: "workspace-1",
        name: "Workbench",
        cwd: "/workspace/project",
        pinned: false,
      },
      automationOrigin,
      executionOrigin,
    },
  };
}

test("projects Pi thread metadata into the backend-neutral presentation contract", () => {
  assert.deepEqual(projectPiAgentThreadSnapshot(nativeSnapshot()), {
    title: "Projected title",
    lastMessageAt,
    createdAt: "2026-08-25T23:00:00.000Z",
    automationOrigin,
    executionOrigin,
    isRunning: true,
    isWaitingForInput: true,
    hasUnreadCompletion: true,
    isPinned: true,
    workspace: {
      id: "workspace-1",
      name: "Workbench",
      rootPath: "/workspace/project",
      pinned: false,
    },
  });
});

test("forwards subscriptions and optional thread mutations to the Pi manager", async () => {
  const calls: string[] = [];
  let subscribedListener: (() => void) | undefined;
  const manager: ThreadStoreManager = {
    getThreadRevision(threadId) {
      calls.push(`revision:${threadId}`);
      return 7;
    },
    getThreadStateSnapshot(threadId) {
      calls.push(`snapshot:${threadId}`);
      return nativeSnapshot();
    },
    subscribeThread(threadId, listener) {
      calls.push(`subscribe:${threadId}`);
      subscribedListener = listener;
      return () => calls.push(`unsubscribe:${threadId}`);
    },
    async setThreadPinned(threadId, pinned) {
      calls.push(`pin:${threadId}:${pinned}`);
    },
    async moveWorkspaceSessionBefore(workspaceId, threadId, beforeThreadId) {
      calls.push(`move:${workspaceId}:${threadId}:${beforeThreadId ?? "end"}`);
    },
  };
  const store = createPiAgentThreadStore(manager);
  const listener = () => calls.push("notified");

  assert.equal(store.getRevision("session-1"), 7);
  assert.equal(store.getSnapshot("session-1").workspace?.rootPath, "/workspace/project");
  const unsubscribe = store.subscribe("session-1", listener);
  subscribedListener?.();
  unsubscribe();
  await store.actions?.setPinned?.("session-1", false);
  await store.actions?.moveWithinWorkspace?.({
    workspaceId: "workspace-1",
    threadId: "session-1",
    beforeThreadId: "session-2",
  });

  assert.deepEqual(calls, [
    "revision:session-1",
    "snapshot:session-1",
    "subscribe:session-1",
    "notified",
    "unsubscribe:session-1",
    "pin:session-1:false",
    "move:workspace-1:session-1:session-2",
  ]);
});
