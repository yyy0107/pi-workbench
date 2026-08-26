"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { SessionContextPolicy, SessionContextPolicyValue } from "../../rpc-contracts";
import {
  compactPiRpcSessionContext,
  getPiRpcSessionContextPolicy,
  updatePiRpcSessionContextPolicy,
} from "../transport/api";

interface ContextPolicySnapshot {
  status: "idle" | "loading" | "ready" | "saving" | "failed";
  value?: SessionContextPolicyValue;
  error?: unknown;
}

const EMPTY_SNAPSHOT: ContextPolicySnapshot = { status: "idle" };
const snapshots = new Map<string, ContextPolicySnapshot>();
const listeners = new Map<string, Set<() => void>>();
const requestRevisions = new Map<string, number>();

function snapshot(sessionId?: string): ContextPolicySnapshot {
  return sessionId ? (snapshots.get(sessionId) ?? EMPTY_SNAPSHOT) : EMPTY_SNAPSHOT;
}

function publish(sessionId: string, next: ContextPolicySnapshot): void {
  snapshots.set(sessionId, next);
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

function subscribe(sessionId: string | undefined, listener: () => void): () => void {
  if (!sessionId) return () => undefined;
  const sessionListeners = listeners.get(sessionId) ?? new Set();
  sessionListeners.add(listener);
  listeners.set(sessionId, sessionListeners);
  return () => {
    sessionListeners.delete(listener);
    if (sessionListeners.size === 0) listeners.delete(sessionId);
  };
}

async function load(sessionId: string, force = false): Promise<SessionContextPolicyValue> {
  const current = snapshot(sessionId);
  if (!force && current.status === "ready" && current.value) return current.value;
  const revision = (requestRevisions.get(sessionId) ?? 0) + 1;
  requestRevisions.set(sessionId, revision);
  publish(sessionId, { ...current, status: "loading", error: undefined });
  try {
    const value = await getPiRpcSessionContextPolicy({ sessionId });
    if (requestRevisions.get(sessionId) === revision) {
      publish(sessionId, { status: "ready", value });
    }
    return value;
  } catch (error) {
    if (requestRevisions.get(sessionId) === revision) {
      publish(sessionId, { ...current, status: "failed", error });
    }
    throw error;
  }
}

async function update(
  sessionId: string,
  policy: SessionContextPolicy,
): Promise<SessionContextPolicyValue> {
  const current = snapshot(sessionId);
  const revision = (requestRevisions.get(sessionId) ?? 0) + 1;
  requestRevisions.set(sessionId, revision);
  publish(sessionId, { ...current, status: "saving", error: undefined });
  try {
    const value = await updatePiRpcSessionContextPolicy({ sessionId, policy });
    if (requestRevisions.get(sessionId) === revision) {
      publish(sessionId, { status: "ready", value });
    }
    return value;
  } catch (error) {
    if (requestRevisions.get(sessionId) === revision) {
      publish(sessionId, { ...current, status: "failed", error });
    }
    throw error;
  }
}

async function compact(sessionId: string): Promise<SessionContextPolicyValue> {
  const current = snapshot(sessionId);
  const revision = (requestRevisions.get(sessionId) ?? 0) + 1;
  requestRevisions.set(sessionId, revision);
  publish(sessionId, { ...current, status: "saving", error: undefined });
  try {
    const result = await compactPiRpcSessionContext({ sessionId });
    if (requestRevisions.get(sessionId) === revision) {
      publish(sessionId, { status: "ready", value: result.context });
    }
    return result.context;
  } catch (error) {
    if (requestRevisions.get(sessionId) === revision) {
      publish(sessionId, { ...current, status: "failed", error });
    }
    throw error;
  }
}

export function useSessionContextPolicy(sessionId?: string) {
  const state = useSyncExternalStore(
    useCallback((listener) => subscribe(sessionId, listener), [sessionId]),
    useCallback(() => snapshot(sessionId), [sessionId]),
    () => EMPTY_SNAPSHOT,
  );

  useEffect(() => {
    if (sessionId) void load(sessionId).catch(() => undefined);
  }, [sessionId]);

  return {
    ...state,
    refresh: useCallback(
      () => (sessionId ? load(sessionId, true) : Promise.resolve(undefined)),
      [sessionId],
    ),
    update: useCallback(
      (policy: SessionContextPolicy) =>
        sessionId ? update(sessionId, policy) : Promise.resolve(undefined),
      [sessionId],
    ),
    compact: useCallback(
      () => (sessionId ? compact(sessionId) : Promise.resolve(undefined)),
      [sessionId],
    ),
  };
}
