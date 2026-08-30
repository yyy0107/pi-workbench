"use client";

import type { HostStreamPayload } from "@workbench/agent-runtime-pi-protocol/stream";

import { automationClient } from "../automations/automation-client";
import { usePiSessionManager } from "../runtime/context";
import { workflowClient } from "../workflows/workflow-client";

export { automationClient, workflowClient };
export { describePiProjectTrust, updatePiProjectTrust } from "../transport/api";

export interface PiExecutionRuntimeClient {
  subscribeHostEvents(listener: (payload: HostStreamPayload) => void): () => void;
  subscribeConnectionReady(listener: () => void): () => void;
}

export function usePiExecutionRuntimeClient(): PiExecutionRuntimeClient {
  const manager = usePiSessionManager();
  return manager;
}
