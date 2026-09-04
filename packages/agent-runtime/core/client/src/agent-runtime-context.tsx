"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import type { WorkbenchContextPolicy } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import {
  WorkbenchAgentCapabilityError,
  type WorkbenchContextCapabilitySnapshot,
} from "./capabilities";
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
const EMPTY_CONTEXT_SNAPSHOT: WorkbenchContextCapabilitySnapshot = Object.freeze({
  status: "idle",
});

export interface WorkbenchAgentRuntimeEnvironment {
  readonly id: string;
  readonly threadId?: string;
  readonly commands: readonly WorkbenchAgentCommand[];
  readonly threadStore?: WorkbenchAgentThreadStore;
  readonly workspaceFiles?: WorkbenchWorkspaceFileSearchPort;
  readonly capabilities: WorkbenchAgentRuntimeCapabilities;
  readonly sessionBinding?: ComponentType<WorkbenchBoundSessionProps>;
}

/** The selected implementation binds session commands and state without changing global selection. */
export interface WorkbenchBoundSessionProps {
  readonly sessionId: string;
  readonly children: ReactNode;
}

export interface WorkbenchAgentRuntimeEnvironmentProviderProps {
  readonly id: string;
  readonly threadId?: string;
  readonly commands: readonly WorkbenchAgentCommand[];
  readonly capabilities?: WorkbenchAgentRuntimeCapabilities;
  readonly threadStore?: WorkbenchAgentThreadStore;
  readonly workspaceFiles?: WorkbenchWorkspaceFileSearchPort;
  readonly sessionBinding?: ComponentType<WorkbenchBoundSessionProps>;
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
  sessionBinding,
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
      ...(sessionBinding ? { sessionBinding } : {}),
    }),
    [capabilities, commands, id, threadId, threadStore, workspaceFiles, sessionBinding],
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

export function WorkbenchBoundSessionProvider({
  fallback = null,
  ...props
}: WorkbenchBoundSessionProps & { readonly fallback?: ReactNode }) {
  const Binding = useWorkbenchAgentRuntimeEnvironment().sessionBinding;
  return Binding ? <Binding {...props} /> : fallback;
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

/** Observe the runtime-owned policy state; no second cache or mutation queue lives in the UI. */
export function useWorkbenchSessionContextPolicy(sessionId?: string) {
  const capability = useWorkbenchContextCapability();
  const state = useSyncExternalStore(
    useCallback(
      (listener) => capability?.subscribe(sessionId, listener) ?? EMPTY_SUBSCRIBE(),
      [capability, sessionId],
    ),
    useCallback(
      () => capability?.getSnapshot(sessionId) ?? EMPTY_CONTEXT_SNAPSHOT,
      [capability, sessionId],
    ),
    () => EMPTY_CONTEXT_SNAPSHOT,
  );
  useEffect(() => {
    if (capability && sessionId) void capability.load(sessionId).catch(() => undefined);
  }, [capability, sessionId]);

  return {
    ...state,
    refresh: useCallback(
      () =>
        capability && sessionId
          ? capability.load(sessionId, true)
          : Promise.reject(new WorkbenchAgentCapabilityError("unavailable")),
      [capability, sessionId],
    ),
    update: useCallback(
      (policy: WorkbenchContextPolicy) =>
        capability && sessionId
          ? capability.update(sessionId, policy)
          : Promise.reject(new WorkbenchAgentCapabilityError("unavailable")),
      [capability, sessionId],
    ),
    compact: useCallback(
      () =>
        capability && sessionId
          ? capability.compact(sessionId)
          : Promise.reject(new WorkbenchAgentCapabilityError("unavailable")),
      [capability, sessionId],
    ),
  };
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
