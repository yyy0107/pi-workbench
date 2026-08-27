import type {
  WorkbenchAgentThreadSnapshot,
  WorkbenchAgentThreadStore,
} from "@/runtime/assistant-ui/agent-runtime-adapter";

import type { PiSessionManager, PiThreadStateSnapshot } from "../runtime/manager";

type PiThreadStoreManager = Pick<
  PiSessionManager,
  | "getThreadRevision"
  | "getThreadStateSnapshot"
  | "subscribeThread"
  | "setThreadPinned"
  | "moveWorkspaceSessionBefore"
>;

/** Project Pi's native thread metadata into the backend-neutral Workbench presentation model. */
export function projectPiAgentThreadSnapshot(
  state: PiThreadStateSnapshot,
): WorkbenchAgentThreadSnapshot {
  const { metadata, thread } = state;
  const workspace = metadata.workspace;

  return {
    ...(thread?.title === undefined ? {} : { title: thread.title }),
    ...(thread?.lastMessageAt === undefined ? {} : { lastMessageAt: thread.lastMessageAt }),
    ...(metadata.createdAt === undefined ? {} : { createdAt: metadata.createdAt }),
    isRunning: metadata.running,
    isWaitingForInput: metadata.waitingForUserInput,
    hasUnreadCompletion: metadata.completed,
    isPinned: metadata.pinned,
    ...(workspace
      ? {
          workspace: {
            id: workspace.id,
            name: workspace.name,
            rootPath: workspace.cwd,
            ...(workspace.pinned === undefined ? {} : { pinned: workspace.pinned }),
          },
        }
      : {}),
  };
}

/** Adapt the existing Pi manager subscriptions and mutations without introducing another cache. */
export function createPiAgentThreadStore(manager: PiThreadStoreManager): WorkbenchAgentThreadStore {
  return {
    getRevision: (threadId) => manager.getThreadRevision(threadId),
    getSnapshot: (threadId) =>
      projectPiAgentThreadSnapshot(manager.getThreadStateSnapshot(threadId)),
    subscribe: (threadId, listener) => manager.subscribeThread(threadId, listener),
    actions: {
      setPinned: (threadId, pinned) => manager.setThreadPinned(threadId, pinned),
      moveWithinWorkspace: ({ workspaceId, threadId, beforeThreadId }) =>
        manager.moveWorkspaceSessionBefore(workspaceId, threadId, beforeThreadId),
    },
  };
}
