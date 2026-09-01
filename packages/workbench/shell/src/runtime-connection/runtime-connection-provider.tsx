"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import type { RuntimeConnection } from "@workbench/host-contracts";

import { snapshotRuntimeConnection } from "./runtime-connection";

const RuntimeConnectionContext = createContext<RuntimeConnection | undefined>(undefined);

/**
 * Owns the renderer's single immutable Runtime connection descriptor.
 *
 * `WorkbenchApplicationProviders.runtimeConnection` is the desktop/test injection seam. Later prop
 * mutation intentionally cannot retarget the already-installed settings, Agent Runtime, or sockets.
 */
export function RuntimeConnectionProvider({
  children,
  connection,
}: Readonly<{ children: ReactNode; connection: RuntimeConnection }>) {
  const [runtimeConnection] = useState(() => snapshotRuntimeConnection(connection));

  return (
    <RuntimeConnectionContext.Provider value={runtimeConnection}>
      {children}
    </RuntimeConnectionContext.Provider>
  );
}

export function useRuntimeConnection(): RuntimeConnection {
  const connection = useContext(RuntimeConnectionContext);
  if (!connection) {
    throw new Error("RuntimeConnectionProvider is required by this Workbench installation.");
  }
  return connection;
}
