export interface SessionCreateIntent {
  workspaceId: string;
  sessionId: string;
}

export function resolveSessionCreateIntent(
  existing: SessionCreateIntent | undefined,
  workspaceId: string,
  createSessionId: () => string,
): SessionCreateIntent {
  if (existing?.workspaceId === workspaceId) return existing;
  return { workspaceId, sessionId: createSessionId() };
}
