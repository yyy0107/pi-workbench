"use client";

import { ThreadPrimitive } from "@assistant-ui/react";
import type { ComponentProps } from "react";

/** Final message-row compatibility seat; removed with the assistant-ui runtime in Phase 8. */
export function LegacyConversationMessageByIndex(
  props: ComponentProps<typeof ThreadPrimitive.MessageByIndex>,
) {
  return <ThreadPrimitive.MessageByIndex {...props} />;
}
