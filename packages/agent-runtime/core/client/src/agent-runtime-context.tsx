"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import type {
  WorkbenchAgentThreadActions,
  WorkbenchAgentThreadSnapshot,
  WorkbenchAgentThreadStore,
  WorkbenchWorkspaceFileSearchPort,
} from "./agent-runtime-environment";
import type {
  WorkbenchAgentRuntimeCapabilities,
  WorkbenchAttachmentUnderstandingCapability,
  WorkbenchContextCapability,
  WorkbenchInteractionCapability,
  WorkbenchModelSelectionCapability,
  WorkbenchRuntimeHostCapability,
  WorkbenchScratchSessionCapability,
  WorkbenchWorkspaceCapability,
} from "./capabilities";

export const EMPTY_WORKBENCH_AGENT_THREAD_SNAPSHOT: WorkbenchAgentThreadSnapshot = Object.freeze({
  isRunning: false,
  isWaitingForInput: false,
  hasUnreadCompletion: false,
  isPinned: false,
});

const EMPTY_THREAD_ACTIONS: WorkbenchAgentThreadActions = Object.freeze({});
const EMPTY_RUNTIME_CAPABILITIES: WorkbenchAgentRuntimeCapabilities = Object.freeze({});
const EMPTY_SUBSCRIBE = () => () => undefined;
const ZERO_REVISION = () => 0;

export interface WorkbenchAgentRuntimeEnvironment {
  readonly id: string;
  readonly threadId?: string;
  readonly commands: readonly WorkbenchAgentCommand[];
  readonly threadStore?: WorkbenchAgentThreadStore;
  readonly workspaceFiles?: WorkbenchWorkspaceFileSearchPort;
  readonly capabilities: WorkbenchAgentRuntimeCapabilities;
}

export interface WorkbenchAgentRuntimeEnvironmentProviderProps {
  readonly id: string;
  readonly threadId?: string;
  readonly commands: readonly WorkbenchAgentCommand[];
  readonly capabilities?: WorkbenchAgentRuntimeCapabilities;
  readonly threadStore?: WorkbenchAgentThreadStore;
  readonly workspaceFiles?: WorkbenchWorkspaceFileSearchPort;
  readonly children: ReactNode;
}

const WorkbenchAgentRuntimeContext = createContext<WorkbenchAgentRuntimeEnvironment | null>(null);

export function WorkbenchAgentRuntimeEnvironmentProvider({
  id,
  threadId,
  commands,
  capabilities = EMPTY_RUNTIME_CAPABILITIES,
  threadStore,
  workspaceFiles,
  children,
}: WorkbenchAgentRuntimeEnvironmentProviderProps) {
  const value = useMemo<WorkbenchAgentRuntimeEnvironment>(
    () => ({
      id,
      ...(threadId ? { threadId } : {}),
      commands,
      capabilities,
      ...(threadStore ? { threadStore } : {}),
      ...(workspaceFiles ? { workspaceFiles } : {}),
    }),
    [capabilities, commands, id, threadId, threadStore, workspaceFiles],
  );

  return (
    <WorkbenchAgentRuntimeContext.Provider value={value}>
      {children}
    </WorkbenchAgentRuntimeContext.Provider>
  );
}

function useWorkbenchAgentRuntimeEnvironment(): WorkbenchAgentRuntimeEnvironment {
  const environment = useContext(WorkbenchAgentRuntimeContext);
  if (!environment) throw new Error("Workbench Agent Runtime environment is missing");
  return environment;
}

/** Return the stable identifier of the Agent Runtime selected by the application composition root. */
export function useWorkbenchAgentRuntimeId(): string {
  return useWorkbenchAgentRuntimeEnvironment().id;
}

/** Session/thread identity owned by the nearest Agent Runtime scope. */
export function useWorkbenchAgentThreadId(): string | undefined {
  return useWorkbenchAgentRuntimeEnvironment().threadId;
}

/** Commands exposed by the selected Agent Runtime for the active conversation or draft. */
export function useWorkbenchAgentCommands(): readonly WorkbenchAgentCommand[] {
  return useWorkbenchAgentRuntimeEnvironment().commands;
}

/** Workspace-file discovery exposed by the selected runtime, when supported. */
export function useWorkbenchAgentWorkspaceFileSearch():
  | WorkbenchWorkspaceFileSearchPort
  | undefined {
  return useWorkbenchAgentRuntimeEnvironment().workspaceFiles;
}

export function useWorkbenchRuntimeHostCapability(): WorkbenchRuntimeHostCapability | undefined {
  return useWorkbenchAgentRuntimeEnvironment().capabilities.host;
}

export function useWorkbenchWorkspaceCapability(): WorkbenchWorkspaceCapability | undefined {
  return useWorkbenchAgentRuntimeEnvironment().capabilities.workspace;
}

export function useWorkbenchModelSelectionCapability():
  | WorkbenchModelSelectionCapability
  | undefined {
  return useWorkbenchAgentRuntimeEnvironment().capabilities.models;
}

export function useWorkbenchInteractionCapability(): WorkbenchInteractionCapability | undefined {
  return useWorkbenchAgentRuntimeEnvironment().capabilities.interactions;
}

export function useWorkbenchScratchSessionCapability():
  | WorkbenchScratchSessionCapability
  | undefined {
  return useWorkbenchAgentRuntimeEnvironment().capabilities.scratchSessions;
}

export function useWorkbenchContextCapability(): WorkbenchContextCapability | undefined {
  return useWorkbenchAgentRuntimeEnvironment().capabilities.context;
}

export function useWorkbenchAutomationCapability(): WorkbenchAgentRuntimeCapabilities["automation"] {
  return useWorkbenchAgentRuntimeEnvironment().capabilities.automation;
}

export function useWorkbenchAttachmentUnderstandingCapability():
  | WorkbenchAttachmentUnderstandingCapability
  | undefined {
  return useWorkbenchAgentRuntimeEnvironment().capabilities.attachmentUnderstanding;
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
