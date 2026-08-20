export function preferredNewThreadWorkspaceId(
  activeWorkspaceId: string | undefined,
  workspaceIds: readonly string[],
): string | undefined {
  if (activeWorkspaceId && workspaceIds.includes(activeWorkspaceId)) return activeWorkspaceId;
  return workspaceIds[0];
}

export function resolveSidebarThreadWorkspaceId({
  customWorkspaceId,
  managedWorkspaceId,
  isMainThread,
  draftWorkspaceId,
}: {
  customWorkspaceId: unknown;
  managedWorkspaceId: unknown;
  isMainThread: boolean;
  draftWorkspaceId: string | undefined;
}): string | undefined {
  if (typeof customWorkspaceId === "string") return customWorkspaceId;
  if (typeof managedWorkspaceId === "string") return managedWorkspaceId;
  return isMainThread ? draftWorkspaceId : undefined;
}
