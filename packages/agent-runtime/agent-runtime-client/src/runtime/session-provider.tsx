"use client";

import type { ReactNode } from "react";

import { useCurrentSession } from "./hooks";
import { SessionContext, useRuntimeContext } from "./context";

export interface SessionProviderProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  /** Bind a nested conversation without changing the Runtime's global current selection. */
  readonly sessionId?: string;
}

/** Resolve a current or explicitly bound Session and key its scoped subtree by stable id. */
export function SessionProvider({ children, fallback = null, sessionId }: SessionProviderProps) {
  const runtime = useRuntimeContext();
  const current = useCurrentSession();
  const resolvedSessionId = sessionId ?? current.sessionId;
  const session = resolvedSessionId ? runtime.session(resolvedSessionId) : undefined;

  if (!session) return fallback;
  return (
    <SessionContext.Provider key={session.id} value={session}>
      {children}
    </SessionContext.Provider>
  );
}
