interface MessageRoleRow {
  role: "user" | "assistant" | "system";
}

/** System separators do not make the preceding conversational pair lose its scroll anchor. */
export function isLastConversationPair(
  messages: readonly MessageRoleRow[],
  pairMessageIndex: number,
): boolean {
  return messages.slice(pairMessageIndex + 1).every((candidate) => candidate.role === "system");
}
