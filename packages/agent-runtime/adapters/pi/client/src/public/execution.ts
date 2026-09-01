"use client";

import type { HostStreamPayload } from "@workbench/agent-runtime-pi-protocol/stream";

import { createContext, createElement, useContext, useMemo, useRef, type ReactNode } from "react";

import { createAutomationClient, type PiAutomationClient } from "../automations/automation-client";
import { usePiSessionManager } from "../runtime/context";
import { createWorkflowClient, type PiWorkflowClient } from "../workflows/workflow-client";
import { describePiProjectTrust, updatePiProjectTrust } from "../transport/api";

export { createAutomationClient, createWorkflowClient };
export type { PiAutomationClient, PiWorkflowClient };

export interface PiExecutionRuntimeClient {
  subscribeHostEvents(listener: (payload: HostStreamPayload) => void): () => void;
  subscribeConnectionReady(listener: () => void): () => void;
}

/** Bound execution domain clients for the manager installed by the current Workbench runtime. */
export interface PiExecutionClient {
  readonly automation: PiAutomationClient;
  readonly workflow: PiWorkflowClient;
  describeProjectTrust: typeof describePiProjectTrust;
  updateProjectTrust: typeof updatePiProjectTrust;
}

export function usePiExecutionClient(): PiExecutionClient {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    return Object.freeze({
      automation: createAutomationClient(options),
      workflow: createWorkflowClient(options),
      describeProjectTrust: (payload: Parameters<typeof describePiProjectTrust>[0]) =>
        describePiProjectTrust(payload, options),
      updateProjectTrust: (payload: Parameters<typeof updatePiProjectTrust>[0]) =>
        updatePiProjectTrust(payload, options),
    });
  }, [manager]);
}

/** Allocate a feature-local browser state holder on the current manager, never at module scope. */
const PiExecutionClientStateContext = createContext<Map<symbol, unknown> | null>(null);

/**
 * Provider-local holders for feature state that belongs to one installed Pi runtime. The map is
 * created with this React provider and is released with it; it is not a module cache or registry.
 */
export function PiExecutionClientStateProvider({ children }: Readonly<{ children: ReactNode }>) {
  const states = useRef<Map<symbol, unknown> | null>(null);
  if (!states.current) states.current = new Map();
  return createElement(PiExecutionClientStateContext.Provider, { value: states.current }, children);
}

/** Get or create feature-local state in the current Pi installation's React lifetime. */
export function usePiExecutionClientState<T>(key: symbol, create: () => T): T {
  const states = useContext(PiExecutionClientStateContext);
  if (!states) throw new Error("PiExecutionClientStateProvider is missing");
  return useMemo(() => {
    const current = states.get(key);
    if (current !== undefined) return current as T;
    const value = create();
    states.set(key, value);
    return value;
  }, [create, key, states]);
}

export function usePiExecutionRuntimeClient(): PiExecutionRuntimeClient {
  const manager = usePiSessionManager();
  return manager;
}
