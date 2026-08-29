"use client";

import { ThreadPrimitive } from "@assistant-ui/react";
import type { ReactNode } from "react";

/**
 * Gives one rendered conversation its own viewport command scope.
 *
 * AssistantRuntimeProvider intentionally exposes a fallback viewport store outside
 * ThreadPrimitive.Viewport and forwards its commands into nested providers. A local
 * scope keeps sibling controls such as ScrollToBottom bound to this conversation
 * instead of issuing commands through that shared fallback store.
 */
export function WorkbenchConversationViewportScope({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <ThreadPrimitive.ViewportProvider>{children}</ThreadPrimitive.ViewportProvider>;
}
