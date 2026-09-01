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
  mainThreadId,
  newThreadId,
  status,
  remoteId,
  externalId,
  hasMessages,
}: {
  mainThreadId: string | undefined;
  newThreadId: string | null | undefined;
  status: string | undefined;
  remoteId: string | undefined;
  externalId: string | undefined;
  hasMessages: boolean;
}): string | undefined {
  if (!mainThreadId || status !== "regular" || mainThreadId === newThreadId || !hasMessages) {
    return undefined;
  }
  // A local assistant-ui id is not a durable route. Waiting for the already-requested
  // remote id avoids changing the address twice during one draft promotion.
  return remoteId ?? externalId;
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
