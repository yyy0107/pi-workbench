"use client";

import type { SessionContextTraceEventSummary } from "@workbench/agent-runtime-pi-protocol/rpc";

import { usePiSessionManager } from "../runtime/context";

export {
  parsePiContextTraceData,
  piContextTraceData,
  WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
} from "../context-trace/data-part";
export type { WorkbenchPiContextTraceDataV1 } from "../context-trace/data-part";
export {
  fetchPiRpcSessionContextTracePromptParts,
  listPiRpcSessionContextTrace,
  listPiRpcSessionContextTraceActivations,
  readPiRpcSessionContextTrace,
} from "../transport/api";
export { usePiActiveSessionId, usePiThreadStateSnapshot } from "../runtime/context";

export interface PiContextTraceEventClient {
  subscribeSessionContextTrace(
    listener: (event: SessionContextTraceEventSummary) => void,
  ): () => void;
}

export function usePiContextTraceEventClient(): PiContextTraceEventClient {
  const manager = usePiSessionManager();
  return manager;
}
