interface MessageRoleRow {
  id: string;
  role: "user" | "assistant" | "system";
}

interface MessageContentRow {
  content: readonly ({ type: string } & Record<string, unknown>)[];
}

interface WorkingStatusState {
  isLastPair: boolean;
  threadIsRunning: boolean;
  assistantStatus?: string;
  assistantHasVisibleContent: boolean;
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

/** Empty streaming text is a placeholder; every other part has visible UI of its own. */
export function messageRowHasVisibleContent(message: MessageContentRow): boolean {
  return message.content.some((part) => {
    if (part.type !== "text" && part.type !== "reasoning") return true;
    return typeof part.text === "string" && part.text.length > 0;
  });
}

/** Keep the waiting row mounted across the gap between run start and assistant placeholder. */
export function shouldShowWorkingStatus({
  isLastPair,
  threadIsRunning,
  assistantStatus,
  assistantHasVisibleContent,
}: WorkingStatusState): boolean {
  return (
    isLastPair && !assistantHasVisibleContent && (threadIsRunning || assistantStatus === "running")
  );
}
