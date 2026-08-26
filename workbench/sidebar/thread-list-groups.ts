import type { PiThreadStateSnapshot } from "@/runtime/pi/client/runtime/manager";
import { resolveSidebarThreadWorkspaceId } from "@/workbench/workspaces/new-thread-policy";

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
  readonly states: ReadonlyMap<string, PiThreadStateSnapshot>;
  readonly mainThreadId?: string;
  readonly draftWorkspaceId?: string;
}): SidebarThreadGroups {
  const pinnedThreadIds: string[] = [];
  const ungroupedThreadIds: string[] = [];
  const threadIdsByWorkspace = new Map<string, string[]>();
  const runningWorkspaceIds = new Set<string>();

  for (const threadId of threadIds) {
    const metadata = states.get(threadId)?.metadata;
    const workspaceId = resolveSidebarThreadWorkspaceId({
      customWorkspaceId: undefined,
      managedWorkspaceId: metadata?.workspace?.id,
      isMainThread: threadId === mainThreadId,
      draftWorkspaceId,
    });
    if (metadata?.running && workspaceId) runningWorkspaceIds.add(workspaceId);

    if (metadata?.pinned) {
      pinnedThreadIds.push(threadId);
      continue;
    }

    if (!workspaceId) {
      ungroupedThreadIds.push(threadId);
      continue;
    }

    const workspaceThreadIds = threadIdsByWorkspace.get(workspaceId);
    if (workspaceThreadIds) workspaceThreadIds.push(threadId);
    else threadIdsByWorkspace.set(workspaceId, [threadId]);
  }

  return { pinnedThreadIds, ungroupedThreadIds, threadIdsByWorkspace, runningWorkspaceIds };
}
