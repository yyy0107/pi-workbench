import type { ThreadMessage } from "@assistant-ui/react";

import type { PiConversationMessage } from "../conversation/pi-conversation-message";

/** Zero-copy compatibility projection; canonical message objects already satisfy the legacy DTO. */
export function assistantUiMessagesFromPiConversation(
  messages: readonly PiConversationMessage[],
): readonly ThreadMessage[] {
  return messages;
}
