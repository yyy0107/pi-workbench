import type {
  SessionContextPolicy,
  SessionContextPolicyValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  compactPiRpcSessionContext,
  getPiRpcSessionContextPolicy,
  updatePiRpcSessionContextPolicy,
  type PiRpcCallOptions,
} from "../transport/api";

export interface ContextPolicySnapshot {
  status: "idle" | "loading" | "ready" | "saving" | "failed";
  value?: SessionContextPolicyValue;
  error?: unknown;
}

export const EMPTY_CONTEXT_POLICY_SNAPSHOT: ContextPolicySnapshot = { status: "idle" };

/** One Runtime installation's session context-policy cache and request coordination. */
export class PiSessionContextPolicyClient {
  private readonly options: Readonly<PiRpcCallOptions>;
  private readonly snapshots = new Map<string, ContextPolicySnapshot>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly requestRevisions = new Map<string, number>();

  constructor(options: Readonly<PiRpcCallOptions>) {
    this.options = options;
  }

  getSnapshot = (sessionId?: string): ContextPolicySnapshot =>
    sessionId
      ? (this.snapshots.get(sessionId) ?? EMPTY_CONTEXT_POLICY_SNAPSHOT)
      : EMPTY_CONTEXT_POLICY_SNAPSHOT;

  subscribe = (sessionId: string | undefined, listener: () => void): (() => void) => {
    if (!sessionId) return () => undefined;
    const sessionListeners = this.listeners.get(sessionId) ?? new Set();
    sessionListeners.add(listener);
    this.listeners.set(sessionId, sessionListeners);
    return () => {
      sessionListeners.delete(listener);
      if (sessionListeners.size === 0) this.listeners.delete(sessionId);
    };
  };

  load = async (sessionId: string, force = false): Promise<SessionContextPolicyValue> => {
    const current = this.getSnapshot(sessionId);
    if (!force && current.status === "ready" && current.value) return current.value;
    const revision = this.nextRequestRevision(sessionId);
    this.publish(sessionId, { ...current, status: "loading", error: undefined });
    try {
      const value = await getPiRpcSessionContextPolicy({ sessionId }, this.options);
      if (this.requestRevisions.get(sessionId) === revision) {
        this.publish(sessionId, { status: "ready", value });
      }
      return value;
    } catch (error) {
      if (this.requestRevisions.get(sessionId) === revision) {
        this.publish(sessionId, { ...current, status: "failed", error });
      }
      throw error;
    }
  };

  update = async (
    sessionId: string,
    policy: SessionContextPolicy,
  ): Promise<SessionContextPolicyValue> => {
    const current = this.getSnapshot(sessionId);
    const revision = this.nextRequestRevision(sessionId);
    this.publish(sessionId, { ...current, status: "saving", error: undefined });
    try {
      const value = await updatePiRpcSessionContextPolicy({ sessionId, policy }, this.options);
      if (this.requestRevisions.get(sessionId) === revision) {
        this.publish(sessionId, { status: "ready", value });
      }
      return value;
    } catch (error) {
      if (this.requestRevisions.get(sessionId) === revision) {
        this.publish(sessionId, { ...current, status: "failed", error });
      }
      throw error;
    }
  };

  compact = async (sessionId: string): Promise<SessionContextPolicyValue> => {
    const current = this.getSnapshot(sessionId);
    const revision = this.nextRequestRevision(sessionId);
    this.publish(sessionId, { ...current, status: "saving", error: undefined });
    try {
      const result = await compactPiRpcSessionContext({ sessionId }, this.options);
      if (this.requestRevisions.get(sessionId) === revision) {
        this.publish(sessionId, { status: "ready", value: result.context });
      }
      return result.context;
    } catch (error) {
      if (this.requestRevisions.get(sessionId) === revision) {
        this.publish(sessionId, { ...current, status: "failed", error });
      }
      throw error;
    }
  };

  private nextRequestRevision(sessionId: string): number {
    const revision = (this.requestRevisions.get(sessionId) ?? 0) + 1;
    this.requestRevisions.set(sessionId, revision);
    return revision;
  }

  private publish(sessionId: string, next: ContextPolicySnapshot): void {
    this.snapshots.set(sessionId, next);
    for (const listener of this.listeners.get(sessionId) ?? []) listener();
  }
}
