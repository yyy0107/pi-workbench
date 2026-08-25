"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { PiWorkspaceSummary } from "../../contracts";
import type { HostDescription } from "../../rpc-contracts";

import {
  PiSessionManager,
  type PiResourceCatalogTarget,
  type PiThreadListItemSnapshot,
} from "./manager";

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

export function usePiThreadListItemSnapshot(
  threadId: string | undefined,
): PiThreadListItemSnapshot | undefined {
  const manager = usePiSessionManager();
  const revision = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  return useMemo(() => manager.getThreadListItemSnapshot(threadId), [manager, revision, threadId]);
}

export function usePiThreadListItemState(threadId: string): {
  thread: PiThreadListItemSnapshot | undefined;
  running: boolean;
  completed: boolean;
} {
  const manager = usePiSessionManager();
  const revision = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  return useMemo(
    () => ({
      thread: manager.getThreadListItemSnapshot(threadId),
      running: manager.isRunning(threadId),
      completed: manager.isCompleted(threadId),
    }),
    [manager, revision, threadId],
  );
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

export function usePiResourceCatalogTargets(): readonly PiResourceCatalogTarget[] {
  const manager = usePiSessionManager();
  useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  const nextTargets = manager.getResourceCatalogTargets();
  const signature = nextTargets
    .map(
      ({ project, sessionId }) =>
        `${sessionId}\u0000${project?.id ?? ""}\u0000${project?.name ?? ""}\u0000${project?.path ?? ""}`,
    )
    .join("\u0001");
  return useMemo(() => manager.getResourceCatalogTargets(), [manager, signature]);
}

export function usePiActiveSessionId(): string | undefined {
  const manager = usePiSessionManager();
  return useSyncExternalStore(
    manager.subscribeActiveSession,
    manager.getActiveSessionId,
    manager.getActiveSessionId,
  );
}
