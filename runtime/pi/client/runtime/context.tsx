"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { PiWorkspaceSummary } from "@/runtime/pi/contracts/pi";
import type { HostDescription } from "@/runtime/pi/contracts/rpc";

import {
  PiSessionManager,
  type PiThreadListItemSnapshot,
  type PiThreadMetadataSnapshot,
  type PiThreadStateSnapshot,
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

export function usePiThreadListItemSnapshot(
  threadId: string | undefined,
): PiThreadListItemSnapshot | undefined {
  return usePiThreadStateSnapshot(threadId).thread;
}

export function usePiThreadListItemState(threadId: string): {
  thread: PiThreadListItemSnapshot | undefined;
  running: boolean;
  completed: boolean;
  metadata: PiThreadMetadataSnapshot;
} {
  const state = usePiThreadStateSnapshot(threadId);
  return {
    thread: state.thread,
    running: state.metadata.running,
    completed: state.metadata.completed,
    metadata: state.metadata,
  };
}

export function usePiThreadStates(
  threadIds: readonly string[],
): ReadonlyMap<string, PiThreadStateSnapshot> {
  const manager = usePiSessionManager();
  const threadIdsSignature = JSON.stringify([...new Set(threadIds)]);
  const stableThreadIds = useMemo(
    () => JSON.parse(threadIdsSignature) as string[],
    [threadIdsSignature],
  );
  const subscribe = useMemo(
    () => (listener: () => void) => {
      const unsubscribers = stableThreadIds.map((threadId) =>
        manager.subscribeThread(threadId, listener),
      );
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [manager, stableThreadIds],
  );
  const getSnapshot = useMemo(
    () => () =>
      JSON.stringify(
        stableThreadIds.map((threadId) => [threadId, manager.getThreadRevision(threadId)]),
      ),
    [manager, stableThreadIds],
  );
  const revisionSignature = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(
    () =>
      new Map(
        stableThreadIds.map((threadId) => [threadId, manager.getThreadStateSnapshot(threadId)]),
      ),
    [manager, revisionSignature, stableThreadIds],
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

export function usePiActiveSessionId(): string | undefined {
  const manager = usePiSessionManager();
  return useSyncExternalStore(
    manager.subscribeActiveSession,
    manager.getActiveSessionId,
    manager.getActiveSessionId,
  );
}
