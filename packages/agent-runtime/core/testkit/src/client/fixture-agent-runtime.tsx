"use client";

import {
  InMemoryThreadListAdapter,
  useExternalStoreRuntime,
  type RemoteThreadListAdapter,
  type ThreadMessage,
} from "@assistant-ui/react";

import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import type {
  WorkbenchAgentRuntimeAdapter,
  WorkbenchAgentThreadSnapshot,
  WorkbenchAgentThreadStore,
} from "@workbench/agent-runtime-client/adapter";

const EMPTY_THREAD_SNAPSHOT: WorkbenchAgentThreadSnapshot = Object.freeze({
  isRunning: false,
  isWaitingForInput: false,
  hasUnreadCompletion: false,
  isPinned: false,
});

class FixtureThreadListAdapter extends InMemoryThreadListAdapter {
  listCalls = 0;

  override list() {
    this.listCalls += 1;
    return super.list();
  }
}

/** Minimal non-Pi implementation used to verify the generic Runtime boundary. */
export function createFixtureAgentRuntime(initialRevision = 0) {
  const threadListAdapter = new FixtureThreadListAdapter();
  const listeners = new Set<() => void>();
  const threadListeners = new Map<string, Set<() => void>>();
  const threadRevisions = new Map<string, number>();
  const threadSnapshots = new Map<string, WorkbenchAgentThreadSnapshot>();
  const messages: readonly ThreadMessage[] = [];
  let revision = initialRevision;
  let subscriptions = 0;
  let threadSubscriptions = 0;
  let commands: readonly WorkbenchAgentCommand[] = [];

  function useThreadRuntime() {
    return useExternalStoreRuntime({
      messages,
      isRunning: false,
      onNew: async () => undefined,
    });
  }

  function useCommandCatalog() {
    return commands;
  }

  const threadStore: WorkbenchAgentThreadStore = {
    getRevision: (threadId) => (threadId ? (threadRevisions.get(threadId) ?? 0) : 0),
    getSnapshot: (threadId) =>
      (threadId ? threadSnapshots.get(threadId) : undefined) ?? EMPTY_THREAD_SNAPSHOT,
    subscribe(threadId, listener) {
      if (!threadId) return () => undefined;
      const scopedListeners = threadListeners.get(threadId) ?? new Set<() => void>();
      if (!threadListeners.has(threadId)) threadListeners.set(threadId, scopedListeners);
      scopedListeners.add(listener);
      threadSubscriptions += 1;
      return () => {
        if (!scopedListeners.delete(listener)) return;
        threadSubscriptions -= 1;
        if (scopedListeners.size === 0) threadListeners.delete(threadId);
      };
    },
  };

  const adapter: WorkbenchAgentRuntimeAdapter = {
    id: "fixture-agent",
    threadListAdapter,
    useThreadRuntime,
    useCommandCatalog,
    threadStore,
    getThreadListRevision: () => revision,
    subscribeThreadList(listener) {
      subscriptions += 1;
      listeners.add(listener);
      return () => {
        if (listeners.delete(listener)) subscriptions -= 1;
      };
    },
  };

  return {
    adapter,
    threadListAdapter: threadListAdapter as RemoteThreadListAdapter & {
      readonly listCalls: number;
    },
    get activeSubscriptions() {
      return subscriptions;
    },
    get activeThreadSubscriptions() {
      return threadSubscriptions;
    },
    get revision() {
      return revision;
    },
    publishThreadListChange() {
      revision += 1;
      for (const listener of listeners) listener();
    },
    setCommands(nextCommands: readonly WorkbenchAgentCommand[]) {
      commands = nextCommands;
    },
    setThreadSnapshot(threadId: string, snapshot: WorkbenchAgentThreadSnapshot) {
      threadSnapshots.set(threadId, snapshot);
      threadRevisions.set(threadId, (threadRevisions.get(threadId) ?? 0) + 1);
      for (const listener of threadListeners.get(threadId) ?? []) listener();
    },
  };
}
