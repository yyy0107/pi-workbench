"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { PiWorkspaceSummary } from "@workbench/agent-runtime-pi-protocol/messages";
import type { HostDescription } from "@workbench/agent-runtime-pi-protocol/rpc";

import { PiSessionManager, type PiThreadStateSnapshot } from "./manager";

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

export function usePiHostDescription(): HostDescription | undefined {
  const manager = usePiSessionManager();
  return useSyncExternalStore(
    manager.subscribe,
    manager.getHostDescription,
    manager.getHostDescription,
  );
}

export function usePiThreadStateSnapshot(threadId: string | undefined): PiThreadStateSnapshot {
  const manager = usePiSessionManager();
  const subscribe = useMemo(
    () => (listener: () => void) => manager.subscribeThread(threadId, listener),
    [manager, threadId],
  );
  const getSnapshot = useMemo(() => () => manager.getThreadRevision(threadId), [manager, threadId]);
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return manager.getThreadStateSnapshot(threadId);
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

export function usePiActiveSessionId(): string | undefined {
  const manager = usePiSessionManager();
  return useSyncExternalStore(
    manager.subscribeActiveSession,
    manager.getActiveSessionId,
    manager.getActiveSessionId,
  );
}
