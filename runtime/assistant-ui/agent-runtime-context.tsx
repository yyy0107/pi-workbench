"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { WorkbenchAgentCommand } from "@/runtime/shared/agent-command/catalog";
import type {
  WorkbenchAgentRuntimeAdapter,
  WorkbenchAgentThreadActions,
  WorkbenchAgentThreadSnapshot,
  WorkbenchAgentThreadStore,
} from "./agent-runtime-adapter";

export const EMPTY_WORKBENCH_AGENT_THREAD_SNAPSHOT: WorkbenchAgentThreadSnapshot = Object.freeze({
  isRunning: false,
  isWaitingForInput: false,
  hasUnreadCompletion: false,
  isPinned: false,
});

const EMPTY_THREAD_ACTIONS: WorkbenchAgentThreadActions = Object.freeze({});
const EMPTY_SUBSCRIBE = () => () => undefined;
const ZERO_REVISION = () => 0;

interface WorkbenchAgentRuntimeEnvironment {
  readonly id: string;
  readonly commands: readonly WorkbenchAgentCommand[];
  readonly threadStore?: WorkbenchAgentThreadStore;
}

const WorkbenchAgentRuntimeContext = createContext<WorkbenchAgentRuntimeEnvironment | null>(null);

export function WorkbenchAgentRuntimeEnvironmentProvider({
  adapter,
  commands,
  children,
}: Readonly<{
  adapter: WorkbenchAgentRuntimeAdapter;
  commands: readonly WorkbenchAgentCommand[];
  children: ReactNode;
}>) {
  const value = useMemo<WorkbenchAgentRuntimeEnvironment>(
    () => ({
      id: adapter.id,
      commands,
      ...(adapter.threadStore ? { threadStore: adapter.threadStore } : {}),
    }),
    [adapter.id, adapter.threadStore, commands],
  );

  return (
    <WorkbenchAgentRuntimeContext.Provider value={value}>
      {children}
    </WorkbenchAgentRuntimeContext.Provider>
  );
}

function useWorkbenchAgentRuntimeEnvironment(): WorkbenchAgentRuntimeEnvironment {
  const environment = useContext(WorkbenchAgentRuntimeContext);
  if (!environment) throw new Error("WorkbenchAgentRuntimeHost is missing");
  return environment;
}

/** Return the stable identifier of the Agent Runtime selected by the application composition root. */
export function useWorkbenchAgentRuntimeId(): string {
  return useWorkbenchAgentRuntimeEnvironment().id;
}

/** Commands exposed by the selected Agent Runtime for the active conversation or draft. */
export function useWorkbenchAgentCommands(): readonly WorkbenchAgentCommand[] {
  return useWorkbenchAgentRuntimeEnvironment().commands;
}

/** Subscribe to the selected implementation's live presentation state for one thread. */
export function useWorkbenchAgentThreadSnapshot(
  threadId: string | undefined,
): WorkbenchAgentThreadSnapshot {
  const store = useWorkbenchAgentRuntimeEnvironment().threadStore;
  const subscribe = useMemo(
    () => (store ? (listener: () => void) => store.subscribe(threadId, listener) : EMPTY_SUBSCRIBE),
    [store, threadId],
  );
  const getRevision = useMemo(
    () => (store ? () => store.getRevision(threadId) : ZERO_REVISION),
    [store, threadId],
  );
  useSyncExternalStore(subscribe, getRevision, getRevision);
  return store?.getSnapshot(threadId) ?? EMPTY_WORKBENCH_AGENT_THREAD_SNAPSHOT;
}

/** Subscribe to a de-duplicated set of threads without exposing an implementation-specific store. */
export function useWorkbenchAgentThreadSnapshots(
  threadIds: readonly string[],
): ReadonlyMap<string, WorkbenchAgentThreadSnapshot> {
  const store = useWorkbenchAgentRuntimeEnvironment().threadStore;
  const threadIdsSignature = JSON.stringify([...new Set(threadIds)]);
  const stableThreadIds = useMemo(
    () => JSON.parse(threadIdsSignature) as string[],
    [threadIdsSignature],
  );
  const subscribe = useMemo(
    () => (listener: () => void) => {
      if (!store) return () => undefined;
      const unsubscribers = stableThreadIds.map((threadId) => store.subscribe(threadId, listener));
      return () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
      };
    },
    [stableThreadIds, store],
  );
  const getRevisionSignature = useMemo(
    () => () =>
      JSON.stringify(
        stableThreadIds.map((threadId) => [threadId, store?.getRevision(threadId) ?? 0]),
      ),
    [stableThreadIds, store],
  );
  const revisionSignature = useSyncExternalStore(
    subscribe,
    getRevisionSignature,
    getRevisionSignature,
  );

  return useMemo(
    () =>
      new Map(
        stableThreadIds.map((threadId) => [
          threadId,
          store?.getSnapshot(threadId) ?? EMPTY_WORKBENCH_AGENT_THREAD_SNAPSHOT,
        ]),
      ),
    [revisionSignature, stableThreadIds, store],
  );
}

/** Optional mutations supported by the currently selected Agent Runtime. */
export function useWorkbenchAgentThreadActions(): WorkbenchAgentThreadActions {
  return useWorkbenchAgentRuntimeEnvironment().threadStore?.actions ?? EMPTY_THREAD_ACTIONS;
}
