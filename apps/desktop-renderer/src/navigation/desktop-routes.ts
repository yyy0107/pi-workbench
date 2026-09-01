export const DESKTOP_CONVERSATION_QUERY_KEY = "conversation" as const;

export function conversationIdFromDesktopUrl(href: string): string | undefined {
  try {
    const conversationId = new URL(href).searchParams.get(DESKTOP_CONVERSATION_QUERY_KEY);
    return conversationId && conversationId.length <= 4_096 ? conversationId : undefined;
  } catch {
    return undefined;
  }
}

export function desktopConversationIdForLaunch(
  href: string,
  persistedConversationId: string | undefined,
): string | undefined {
  return conversationIdFromDesktopUrl(href) ?? persistedConversationId;
}

export function desktopUrlForConversation(
  href: string,
  conversationId: string | undefined,
): string {
  const url = new URL(href);
  if (conversationId) url.searchParams.set(DESKTOP_CONVERSATION_QUERY_KEY, conversationId);
  else url.searchParams.delete(DESKTOP_CONVERSATION_QUERY_KEY);
  return url.href;
}
