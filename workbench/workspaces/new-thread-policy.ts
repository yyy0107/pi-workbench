export function preferredNewThreadWorkspaceId(
  activeWorkspaceId: string | undefined,
  workspaceIds: readonly string[],
): string | undefined {
  if (activeWorkspaceId && workspaceIds.includes(activeWorkspaceId)) return activeWorkspaceId;
  return workspaceIds[0];
}

export function conversationThreadIdFromPathname(pathname: string): string | undefined {
  const match = /^\/c\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return undefined;

  try {
    const threadId = decodeURIComponent(match[1]);
    return threadId === "new" ? undefined : threadId;
  } catch {
    return undefined;
  }
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

export function resolvePendingThreadPromotionId({
  pendingThreadId,
  mainThreadId,
  status,
  remoteId,
  hasMessages,
}: {
  pendingThreadId: string | undefined;
  mainThreadId: string | undefined;
  status: string | undefined;
  remoteId: string | undefined;
  hasMessages: boolean;
}): string | undefined {
  if (!mainThreadId || status !== "regular") return undefined;
  if (pendingThreadId && pendingThreadId !== mainThreadId) pendingThreadId = undefined;

  // assistant-ui initializes the remote thread before invoking `onNew`. A thread-list
  // reload in that gap replaces the promoted draft generation and silently drops its
  // first message. Remember that promotion until the optimistic user message proves
  // `onNew` has started; an already-persisted empty remote thread never enters this path.
  if (!remoteId) return mainThreadId;
  if (pendingThreadId === mainThreadId && !hasMessages) return mainThreadId;
  return undefined;
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
