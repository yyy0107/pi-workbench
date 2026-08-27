"use client";

import { useEffect } from "react";
import { useRemoteThreadListRuntime } from "@assistant-ui/react";

import type { WorkbenchAgentRuntimeAdapter } from "./agent-runtime-adapter";

export function useWorkbenchRuntime(adapter: WorkbenchAgentRuntimeAdapter) {
  const runtime = useRemoteThreadListRuntime({
    adapter: adapter.threadListAdapter,
    runtimeHook: adapter.useThreadRuntime,
  });
  useEffect(
    () =>
      adapter.subscribeThreadList(() => {
        void runtime.threads
          .reload()
          .catch((error) =>
            console.error(
              `[workbench-agent-runtime:${adapter.id}] thread list reload failed`,
              error,
            ),
          );
      }),
    [adapter, runtime],
  );
  return runtime;
}
