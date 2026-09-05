export interface MessageActionVisibilityMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly branchCount?: number;
  readonly isLast?: boolean;
  readonly status?: { readonly type: string };
}

export function shouldHideMessageActionBar(
  message: MessageActionVisibilityMessage,
  isThreadRunning: boolean,
): boolean {
  // A persisted legacy assistant step can be complete while the enclosing tool-driven turn continues.
  // Keep the active response's actions hidden until the thread run itself has ended.
  return (
    message.role === "assistant" &&
    (message.status?.type === "running" || (isThreadRunning && message.isLast === true))
  );
}

function hasActionableAssistantContent(message: MessageActionVisibilityMessage): boolean {
  return message.content.some((part) => {
    if (part.type === "text") return Boolean(part.text?.trim());
    return part.type !== "reasoning" && part.type !== "tool-call";
  });
}

export function isLastAssistantInTurn(
  messages: readonly Pick<MessageActionVisibilityMessage, "role">[],
  messageIndex: number,
): boolean {
  if (messages[messageIndex]?.role !== "assistant") return false;

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const nextMessage = messages[index];
    if (!nextMessage || nextMessage.role === "user") break;
    if (nextMessage.role === "assistant") return false;
  }

  return true;
}

export function shouldShowMessageActions(
  messages: readonly MessageActionVisibilityMessage[],
  messageIndex: number,
): boolean {
  const message = messages[messageIndex];
  if (!message || message.role === "system") return false;
  if (message.role === "user") return true;

  return isLastAssistantInTurn(messages, messageIndex) && hasActionableAssistantContent(message);
}

/** Branch navigation must remain reachable even when a branch has no renderable content. */
export function shouldShowMessageNavigation(
  messages: readonly MessageActionVisibilityMessage[],
  messageIndex: number,
  canSwitchToBranch: boolean,
): boolean {
  const message = messages[messageIndex];
  return Boolean(
    canSwitchToBranch && message && message.role !== "system" && (message.branchCount ?? 1) > 1,
  );
}
