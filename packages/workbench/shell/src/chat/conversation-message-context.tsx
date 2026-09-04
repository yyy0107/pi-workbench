"use client";

import { createContext, useContext, type PropsWithChildren } from "react";

export interface ConversationMessageContextValue {
  readonly messageId: string;
  readonly role: "user" | "assistant" | "system";
  readonly isLast: boolean;
  readonly index: number;
}

const ConversationMessageContext = createContext<ConversationMessageContextValue | null>(null);

export function ConversationMessageProvider({
  value,
  children,
}: PropsWithChildren<{ readonly value: ConversationMessageContextValue }>) {
  return (
    <ConversationMessageContext.Provider value={value}>
      {children}
    </ConversationMessageContext.Provider>
  );
}

export function useConversationMessageContext(): ConversationMessageContextValue {
  const value = useContext(ConversationMessageContext);
  if (!value) throw new Error("Conversation message scope is unavailable");
  return value;
}
