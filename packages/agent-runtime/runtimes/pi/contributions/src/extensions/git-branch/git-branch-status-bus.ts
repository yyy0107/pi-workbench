import type { WorkspaceGitStatus } from "@workbench/agent-runtime-pi-protocol/rpc";

export type GitBranchStatusListener = (workspaceId: string, status: WorkspaceGitStatus) => void;

/**
 * Status fanout is partitioned by the stable workspace-client object created for each Pi runtime
 * installation. Workspace ids are only meaningful inside that transport, so a module-wide id-only
 * set would let two renderer roots cross-update one another.
 */
const listenersByWorkspaceClient = new WeakMap<object, Set<GitBranchStatusListener>>();

export function subscribeGitBranchStatus(
  workspaceClient: object,
  listener: GitBranchStatusListener,
): () => void {
  const listeners = listenersByWorkspaceClient.get(workspaceClient) ?? new Set();
  listeners.add(listener);
  listenersByWorkspaceClient.set(workspaceClient, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByWorkspaceClient.delete(workspaceClient);
  };
}

export function publishGitBranchStatus(
  workspaceClient: object,
  workspaceId: string,
  status: WorkspaceGitStatus,
): void {
  for (const listener of listenersByWorkspaceClient.get(workspaceClient) ?? []) {
    listener(workspaceId, status);
  }
}
