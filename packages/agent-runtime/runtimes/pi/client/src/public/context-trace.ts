"use client";

import type { SessionContextTraceEventSummary } from "@workbench/agent-runtime-pi-protocol/rpc";

import { useMemo } from "react";

import { usePiSessionManager } from "../runtime/context";
import {
  listPiRpcSessionContextTrace,
  listPiRpcSessionContextTraceActivations,
  readPiRpcSessionContextTrace,
} from "../transport/api";

export {
  parsePiContextTraceData,
  piContextTracePromptInjections,
  WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
} from "../context-trace/data-part";
export { usePiActiveSessionId, usePiThreadStateSnapshot } from "../runtime/context";

export interface PiContextTraceEventClient {
  subscribeSessionContextTrace(
    listener: (event: SessionContextTraceEventSummary) => void,
  ): () => void;
  subscribeConnectionReady(listener: () => void): () => void;
}

export function usePiContextTraceEventClient(): PiContextTraceEventClient {
  const manager = usePiSessionManager();
  return manager;
}

/** Bind trace queries to the same runtime host that owns the active Pi manager. */
export function usePiContextTraceClient() {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    return {
      list: (payload: Parameters<typeof listPiRpcSessionContextTrace>[0]) =>
        listPiRpcSessionContextTrace(payload, options),
      listActivations: (payload: Parameters<typeof listPiRpcSessionContextTraceActivations>[0]) =>
        listPiRpcSessionContextTraceActivations(payload, options),
      read: (payload: Parameters<typeof readPiRpcSessionContextTrace>[0]) =>
        readPiRpcSessionContextTrace(payload, options),
    };
  }, [manager]);
}
