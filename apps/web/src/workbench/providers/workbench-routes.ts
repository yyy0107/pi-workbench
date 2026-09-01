export function conversationIdFromWorkbenchPathname(pathname: string): string | undefined {
  const match = /^\/c\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return undefined;
  try {
    const conversationId = decodeURIComponent(match[1]);
    return conversationId || undefined;
  } catch {
    return undefined;
  }
}
