interface MessageRoleRow {
  id: string;
  role: "user" | "assistant" | "system";
}

interface WorkingStatusState {
  isLastPair: boolean;
  threadIsRunning: boolean;
  assistantStatus?: string;
}

/** A conversational turn keeps the identity of its first message as assistant output arrives. */
export function conversationPairKey(message: MessageRoleRow): string {
  return message.id;
}

/** System separators do not make the preceding conversational pair stop being the active turn. */
export function isLastConversationPair(
  messages: readonly MessageRoleRow[],
  pairMessageIndex: number,
): boolean {
  return messages.slice(pairMessageIndex + 1).every((candidate) => candidate.role === "system");
}

/** Keep the working row mounted from run start until both runtime signals report completion. */
export function shouldShowWorkingStatus({
  isLastPair,
  threadIsRunning,
  assistantStatus,
}: WorkingStatusState): boolean {
  return isLastPair && (threadIsRunning || assistantStatus === "running");
}
