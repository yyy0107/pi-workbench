export function preferredNewThreadWorkspaceId(
  activeWorkspaceId: string | undefined,
  workspaceIds: readonly string[],
): string | undefined {
  if (activeWorkspaceId && workspaceIds.includes(activeWorkspaceId)) return activeWorkspaceId;
  return workspaceIds[0];
}

export function shouldProjectNewThreadRoute({
  routeThreadId,
  syncedRouteThreadId,
  isNewThread,
}: {
  routeThreadId: string | undefined;
  syncedRouteThreadId: string | null;
  isNewThread: boolean;
}): boolean {
  return routeThreadId !== undefined && isNewThread && syncedRouteThreadId === routeThreadId;
}

export function shouldCloseRightWorkspaceForNewThread({
  hydrated,
  mainThreadId,
  newThreadId,
  alreadyHandled,
}: {
  hydrated: boolean;
  mainThreadId: string | undefined;
  newThreadId: string | null | undefined;
  alreadyHandled: boolean;
}): boolean {
  return hydrated && mainThreadId !== undefined && mainThreadId === newThreadId && !alreadyHandled;
}

export function resolvePromotedThreadRouteId({
  isNewThread,
  threadId,
  hasMessages,
}: {
  isNewThread: boolean;
  threadId: string | undefined;
  hasMessages: boolean;
}): string | undefined {
  return !isNewThread && hasMessages ? threadId : undefined;
}

export function resolveSidebarThreadWorkspaceId({
  managedWorkspaceId,
  isMainThread,
  draftWorkspaceId,
}: {
  managedWorkspaceId: unknown;
  isMainThread: boolean;
  draftWorkspaceId: string | undefined;
}): string | undefined {
  if (typeof managedWorkspaceId === "string") return managedWorkspaceId;
  return isMainThread ? draftWorkspaceId : undefined;
}
