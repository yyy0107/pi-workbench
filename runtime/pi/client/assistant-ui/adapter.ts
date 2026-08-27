"use client";

import type { WorkbenchAgentRuntimeAdapter } from "@/runtime/assistant-ui/agent-runtime-adapter";

import type { PiSessionManager } from "../runtime/manager";
import { usePiAgentCommandCatalog } from "./command-catalog";
import { createPiAgentThreadStore } from "./thread-store";
import { usePiThreadRuntime } from "./thread-runtime";

export const PI_AGENT_RUNTIME_ADAPTER_ID = "pi";

/** Create the only currently installed Workbench Agent Runtime implementation. */
export function createPiAgentRuntimeAdapter(
  manager: PiSessionManager,
): WorkbenchAgentRuntimeAdapter {
  const threadStore = createPiAgentThreadStore(manager);

  function useThreadRuntime() {
    return usePiThreadRuntime(manager);
  }

  function useCommandCatalog() {
    return usePiAgentCommandCatalog(manager);
  }

  return {
    id: PI_AGENT_RUNTIME_ADAPTER_ID,
    threadListAdapter: manager.createThreadListAdapter(),
    useThreadRuntime,
    useCommandCatalog,
    threadStore,
    getThreadListRevision: manager.getThreadListRevision,
    subscribeThreadList: manager.subscribeThreadList,
  };
}
