"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRemoteThreadListRuntime } from "@assistant-ui/react";

import type { WorkbenchAgentRuntimeAdapter } from "./agent-runtime-adapter";
import { createThreadListReloadCoordinator } from "./thread-list-reload-coordinator";

export function useWorkbenchRuntime(adapter: WorkbenchAgentRuntimeAdapter) {
  const runtime = useRemoteThreadListRuntime({
    adapter: adapter.threadListAdapter,
    runtimeHook: adapter.useThreadRuntime,
  });
  const subscribeThreadList = useCallback(
    (listener: () => void) => adapter.subscribeThreadList(listener),
    [adapter],
  );
  const getThreadListRevision = useCallback(() => adapter.getThreadListRevision(), [adapter]);
  const threadListRevision = useSyncExternalStore(
    subscribeThreadList,
    getThreadListRevision,
    getThreadListRevision,
  );
  const reloadCoordinator = useRef<ReturnType<typeof createThreadListReloadCoordinator> | null>(
    null,
  );
  const observedRevision = useRef({ adapter, revision: threadListRevision });

  if (observedRevision.current.adapter !== adapter) {
    observedRevision.current = { adapter, revision: threadListRevision };
  }

  useEffect(() => {
    // Create this inside the Effect so a Strict Effects cleanup/setup cycle receives a fresh
    // coordinator instead of reusing an already-disposed memoized instance.
    const coordinator = createThreadListReloadCoordinator({
      reload: () => runtime.threads.reload(),
      onError: (error) =>
        console.error(`[workbench-agent-runtime:${adapter.id}] thread list reload failed`, error),
    });
    reloadCoordinator.current = coordinator;
    return () => {
      if (reloadCoordinator.current === coordinator) reloadCoordinator.current = null;
      coordinator.dispose();
    };
  }, [adapter.id, runtime]);

  useEffect(() => {
    if (observedRevision.current.revision === threadListRevision) return;
    observedRevision.current.revision = threadListRevision;
    reloadCoordinator.current?.request();
  }, [threadListRevision]);

  return runtime;
}
