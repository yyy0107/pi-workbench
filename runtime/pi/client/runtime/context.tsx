"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { PiWorkspaceSummary } from "../../contracts";

import { PiSessionManager } from "./manager";

const PiSessionManagerContext = createContext<PiSessionManager | null>(null);

export function PiSessionManagerProvider({
  children,
  manager,
}: Readonly<{ children: ReactNode; manager: PiSessionManager }>) {
  return (
    <PiSessionManagerContext.Provider value={manager}>{children}</PiSessionManagerContext.Provider>
  );
}

export function usePiSessionManager(): PiSessionManager {
  const manager = useContext(PiSessionManagerContext);
  if (!manager) throw new Error("PiSessionManagerProvider is missing");
  return manager;
}

export function usePiThreadActivity(threadId: string): {
  running: boolean;
  completed: boolean;
} {
  const manager = usePiSessionManager();
  useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  return {
    running: manager.isRunning(threadId),
    completed: manager.isCompleted(threadId),
  };
}

export function usePiWorkspaces(): readonly PiWorkspaceSummary[] {
  const manager = usePiSessionManager();
  const revision = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  return useMemo(() => manager.getWorkspaces(), [manager, revision]);
}
