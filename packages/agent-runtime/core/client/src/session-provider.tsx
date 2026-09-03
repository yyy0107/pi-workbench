"use client";

import type { ReactNode } from "react";

import { useCurrentSession } from "./hooks";
import { SessionContext, useRuntimeContext } from "./runtime-context";

export interface SessionProviderProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

/** Resolve the current Session and remount only its scoped subtree when its stable id changes. */
export function SessionProvider({ children, fallback = null }: SessionProviderProps) {
  const runtime = useRuntimeContext();
  const { sessionId } = useCurrentSession();
  const session = sessionId ? runtime.session(sessionId) : undefined;

  if (!session) return fallback;
  return (
    <SessionContext.Provider key={session.id} value={session}>
      {children}
    </SessionContext.Provider>
  );
}
