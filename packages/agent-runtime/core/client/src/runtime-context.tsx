"use client";

import { createContext, useContext } from "react";

import type { AgentRuntime, ConversationSession } from "@workbench/agent-runtime-core";

export const RuntimeContext = createContext<AgentRuntime | null>(null);
export const SessionContext = createContext<ConversationSession | null>(null);

export function useRuntimeContext(): AgentRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("RuntimeProvider is missing");
  return runtime;
}

export function useSessionContext(): ConversationSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider is missing");
  return session;
}
