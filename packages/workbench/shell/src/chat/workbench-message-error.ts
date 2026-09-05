interface MessageErrorVisibility {
  readonly isRunning: boolean;
  readonly isInLatestTurn: boolean;
  readonly isLastAssistantInTurn: boolean;
  readonly terminationKind?: string;
}

interface MessageTurnEntry {
  readonly role: "user" | "assistant" | "system";
}

/** A later user message is the boundary between the active/latest turn and message history. */
export function isMessageInLatestTurn(
  messages: readonly MessageTurnEntry[],
  messageIndex: number,
): boolean {
  if (!messages[messageIndex]) return false;

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") return false;
  }

  return true;
}

/** A continuation supersedes earlier stopped cards without changing the stored messages. */
export function shouldShowMessageError({
  isRunning,
  isInLatestTurn,
  isLastAssistantInTurn,
  terminationKind,
}: MessageErrorVisibility): boolean {
  if (
    (terminationKind === "cancelled" || terminationKind === "aborted") &&
    !isLastAssistantInTurn
  ) {
    return false;
  }
  return terminationKind !== "completed" && (!isRunning || !isInLatestTurn);
}
