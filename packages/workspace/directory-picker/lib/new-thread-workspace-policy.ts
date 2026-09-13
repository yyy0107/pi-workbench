export function preferredNewThreadWorkspaceId(
  activeWorkspaceId: string | undefined,
  workspaceIds: readonly string[],
): string | undefined {
  if (activeWorkspaceId && workspaceIds.includes(activeWorkspaceId)) return activeWorkspaceId;
  return workspaceIds[0];
}
