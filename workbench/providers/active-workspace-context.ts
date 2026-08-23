import type { WorkspaceContext, WorkspaceScope } from "@/components/right-workspace";

export interface ActiveWorkspaceContextInput {
  threadId?: string;
  workspaceId?: string;
  rootPath?: string;
}

export function activeWorkspaceContext({
  threadId,
  workspaceId,
  rootPath,
}: ActiveWorkspaceContextInput): WorkspaceContext {
  return {
    applicationId: "pi-workbench",
    ...(threadId ? { threadId } : {}),
    ...(workspaceId ? { projectId: workspaceId, worktreeId: workspaceId } : {}),
    ...(rootPath ? { rootPath } : {}),
  };
}

export function shouldPromoteThreadSurfaceScope(
  scope: WorkspaceScope,
  promotedScopeId: string | undefined,
): boolean {
  return Boolean(promotedScopeId && scope.type === "thread" && scope.key === promotedScopeId);
}
