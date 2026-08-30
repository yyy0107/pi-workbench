"use client";

import type { WorkbenchAgentRuntimeAdapter } from "@workbench/agent-runtime-client/adapter";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";

import type { PiSessionManager } from "../runtime/manager";
import { usePiAgentCommandCatalog } from "./command-catalog";
import { createPiAgentThreadStore } from "./thread-store";
import { usePiThreadRuntime } from "./thread-runtime";
import { searchPiWorkspaceFiles } from "../transport/api";

const PI_WORKSPACE_FILES: NonNullable<WorkbenchAgentRuntimeAdapter["workspaceFiles"]> = {
  async search({ signal, ...payload }) {
    const result = await searchPiWorkspaceFiles(payload, { signal });
    return result.entries.map(({ relativePath }) => ({ relativePath }));
  },
};

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
    id: PI_AGENT_RUNTIME_DESCRIPTOR.id,
    threadListAdapter: manager.createThreadListAdapter(),
    useThreadRuntime,
    useCommandCatalog,
    threadStore,
    workspaceFiles: PI_WORKSPACE_FILES,
    getThreadListRevision: manager.getThreadListRevision,
    subscribeThreadList: manager.subscribeThreadList,
  };
}
