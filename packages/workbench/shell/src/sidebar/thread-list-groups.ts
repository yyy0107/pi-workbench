import type { WorkbenchAgentThreadSnapshot } from "@workbench/agent-runtime-client/adapter";
import { resolveSidebarThreadWorkspaceId } from "../new-thread-policy";

export interface SidebarThreadGroups {
  readonly pinnedThreadIds: readonly string[];
  readonly ungroupedThreadIds: readonly string[];
  readonly threadIdsByWorkspace: ReadonlyMap<string, readonly string[]>;
  readonly runningWorkspaceIds: ReadonlySet<string>;
}

export function groupSidebarThreads({
  threadIds,
  states,
  mainThreadId,
  draftWorkspaceId,
}: {
  readonly threadIds: readonly string[];
  readonly states: ReadonlyMap<string, WorkbenchAgentThreadSnapshot>;
  readonly mainThreadId?: string;
  readonly draftWorkspaceId?: string;
}): SidebarThreadGroups {
  const pinnedThreadIds: string[] = [];
  const ungroupedThreadIds: string[] = [];
  const threadIdsByWorkspace = new Map<string, string[]>();
  const runningWorkspaceIds = new Set<string>();

  for (const threadId of threadIds) {
    const state = states.get(threadId);
    const workspaceId = resolveSidebarThreadWorkspaceId({
      customWorkspaceId: undefined,
      managedWorkspaceId: state?.workspace?.id,
      isMainThread: threadId === mainThreadId,
      draftWorkspaceId,
    });
    if (state?.isPinned) {
      pinnedThreadIds.push(threadId);
      continue;
    }

    if (state?.isRunning && workspaceId) runningWorkspaceIds.add(workspaceId);

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
