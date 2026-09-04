"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { SessionContextPolicy } from "@workbench/agent-runtime-pi-protocol/rpc";

import { usePiSessionManager } from "../runtime/context";
import { EMPTY_CONTEXT_POLICY_SNAPSHOT } from "./session-context-policy-client";

export function useSessionContextPolicy(sessionId?: string) {
  const manager = usePiSessionManager();
  const client = manager.contextPolicies;
  const state = useSyncExternalStore(
    useCallback((listener) => client.subscribe(sessionId, listener), [client, sessionId]),
    useCallback(() => client.getSnapshot(sessionId), [client, sessionId]),
    () => EMPTY_CONTEXT_POLICY_SNAPSHOT,
  );

  useEffect(() => {
    if (sessionId) void client.load(sessionId).catch(() => undefined);
  }, [client, sessionId]);

  return {
    ...state,
    refresh: useCallback(
      () => (sessionId ? client.load(sessionId, true) : Promise.resolve(undefined)),
      [client, sessionId],
    ),
    update: useCallback(
      (policy: SessionContextPolicy) =>
        sessionId ? client.update(sessionId, policy) : Promise.resolve(undefined),
      [client, sessionId],
    ),
    compact: useCallback(
      () => (sessionId ? client.compact(sessionId) : Promise.resolve(undefined)),
      [client, sessionId],
    ),
  };
}
