import type { WorkspaceContext } from "@/components/right-workspace";

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
