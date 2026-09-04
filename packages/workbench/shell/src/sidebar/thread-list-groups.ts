import type { ThreadListItem } from "@workbench/agent-runtime-client";
import { resolveSidebarThreadWorkspaceId } from "../new-thread-policy";

export interface SidebarThreadGroups {
  readonly pinnedThreadIds: readonly string[];
  readonly ungroupedThreadIds: readonly string[];
  readonly threadIdsByWorkspace: ReadonlyMap<string, readonly string[]>;
  readonly runningWorkspaceIds: ReadonlySet<string>;
}

export function groupSidebarThreads({
  threads,
  mainThreadId,
  draftWorkspaceId,
}: {
  readonly threads: readonly ThreadListItem[];
  readonly mainThreadId?: string;
  readonly draftWorkspaceId?: string;
}): SidebarThreadGroups {
  const pinnedThreadIds: string[] = [];
  const ungroupedThreadIds: string[] = [];
  const threadIdsByWorkspace = new Map<string, string[]>();
  const runningWorkspaceIds = new Set<string>();

  for (const thread of threads) {
    const threadId = thread.threadId;
    const workspaceId = resolveSidebarThreadWorkspaceId({
      managedWorkspaceId: thread.workspace?.id,
      isMainThread: threadId === mainThreadId,
      draftWorkspaceId,
    });
    if (thread.isPinned) {
      pinnedThreadIds.push(threadId);
      continue;
    }

    if (thread.isRunning && workspaceId) runningWorkspaceIds.add(workspaceId);

    if (!workspaceId) {
      ungroupedThreadIds.push(threadId);
      continue;
    }

    const workspaceThreadIds = threadIdsByWorkspace.get(workspaceId);
    if (workspaceThreadIds) workspaceThreadIds.push(threadId);
    else threadIdsByWorkspace.set(workspaceId, [threadId]);
  }

  return {
    pinnedThreadIds,
    ungroupedThreadIds,
    threadIdsByWorkspace,
    runningWorkspaceIds,
  };
}
