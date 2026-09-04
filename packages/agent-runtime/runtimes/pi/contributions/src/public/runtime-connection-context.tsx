"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { RuntimeConnection } from "@workbench/host-contracts";

const PiRuntimeConnectionContext = createContext<RuntimeConnection | null>(null);

/**
 * Installation-owned transport descriptor for Pi contribution components.
 *
 * The application decides how the descriptor is created; this leaf package only consumes the
 * public, immutable host-contracts value it receives.
 */
export function PiRuntimeConnectionProvider({
  children,
  connection,
}: Readonly<{
  children: ReactNode;
  connection: RuntimeConnection;
}>) {
  return (
    <PiRuntimeConnectionContext.Provider value={connection}>
      {children}
    </PiRuntimeConnectionContext.Provider>
  );
}

export function usePiRuntimeConnection(): RuntimeConnection {
  const connection = useContext(PiRuntimeConnectionContext);
  if (!connection) {
    throw new Error(
      "PiAgentRuntimeContributionsProvider is required by Pi contribution components.",
    );
  }
  return connection;
}
