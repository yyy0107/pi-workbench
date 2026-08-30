"use client";

import { useCallback, useEffect, useState } from "react";

import {
  listPiRpcSessionContextTrace,
  listPiRpcSessionContextTraceActivations,
  usePiContextTraceEventClient,
} from "@/workbench/runtime-contributions/pi/client/context-trace";
import type {
  SessionContextTraceCapabilities,
  SessionContextTraceEventSummary,
} from "@/workbench/runtime-contributions/pi/protocol/rpc";

import { selectContextTraceActivation } from "./context-trace-activation";

export type ContextTraceLoadStatus = "loading" | "ready" | "error" | "permission-required";

export interface ContextTraceSnapshot {
  activationId?: string;
  events: SessionContextTraceEventSummary[];
  retainedFromSeq: number;
  nextSeq: number;
  hasMore: boolean;
  loadingMore: boolean;
  source?: "memory" | "disk";
  integrity?: "memory" | "verified";
  capabilities?: SessionContextTraceCapabilities;
  status: ContextTraceLoadStatus;
  error?: unknown;
  loadMore(): Promise<void>;
}

export interface ContextTraceTargetSnapshot {
  activationId?: string;
  status: ContextTraceLoadStatus;
  error?: unknown;
}

const DEFAULT_SUMMARY_LIMIT = 512;
const DURABLE_SUMMARY_LIMIT = 2_000;
const EMPTY_LOAD_MORE = async () => undefined;

function initialSnapshot(): ContextTraceSnapshot {
  return {
    events: [],
    retainedFromSeq: 0,
    nextSeq: 0,
    hasMore: false,
    loadingMore: false,
    status: "loading",
    loadMore: EMPTY_LOAD_MORE,
  };
}

function mergeEvents(
  existing: readonly SessionContextTraceEventSummary[],
  incoming: readonly SessionContextTraceEventSummary[],
): SessionContextTraceEventSummary[] {
  const byKey = new Map(existing.map((event) => [`${event.activationId}:${event.seq}`, event]));
  for (const event of incoming) byKey.set(`${event.activationId}:${event.seq}`, event);
  return [...byKey.values()].sort((left, right) => left.seq - right.seq);
}

function limitEvents(
  events: readonly SessionContextTraceEventSummary[],
  limit: number,
): SessionContextTraceEventSummary[] {
  return events.length > limit ? events.slice(-limit) : [...events];
}

function eventWindowLimit(capabilities: SessionContextTraceCapabilities | undefined): number {
  return capabilities?.durable
    ? DURABLE_SUMMARY_LIMIT
    : (capabilities?.maxEvents ?? DEFAULT_SUMMARY_LIMIT);
}

function isPermissionError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status?: unknown }).status === 403,
  );
}

export function useContextTraceTarget(
  sessionId: string,
  refreshRevision: number,
  running: boolean,
): ContextTraceTargetSnapshot {
  const [snapshot, setSnapshot] = useState<ContextTraceTargetSnapshot>({ status: "loading" });

  useEffect(() => {
    let active = true;
    if (running) {
      setSnapshot({ status: "ready" });
      return () => {
        active = false;
      };
    }

    setSnapshot({ status: "loading" });
    void listPiRpcSessionContextTraceActivations({ sessionId })
      .then((value) => {
        if (!active) return;
        setSnapshot({
          activationId: selectContextTraceActivation(value.activations, value.currentActivationId),
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSnapshot({
          status: isPermissionError(error) ? "permission-required" : "error",
          error,
        });
      });

    return () => {
      active = false;
    };
  }, [refreshRevision, running, sessionId]);

  return snapshot;
}

export function useContextTrace(
  sessionId: string,
  refreshRevision: number,
  requestedActivationId?: string,
): ContextTraceSnapshot {
  const manager = usePiContextTraceEventClient();
  const [snapshot, setSnapshot] = useState<ContextTraceSnapshot>(initialSnapshot);

  const acceptLiveEvent = useCallback(
    (event: SessionContextTraceEventSummary) => {
      if (requestedActivationId || event.sessionId !== sessionId) return;
      setSnapshot((current) => {
        const activationChanged =
          current.activationId !== undefined && current.activationId !== event.activationId;
        const merged = mergeEvents(activationChanged ? [] : current.events, [event]);
        const events = limitEvents(merged, eventWindowLimit(current.capabilities));
        return {
          ...current,
          activationId: event.activationId,
          events,
          retainedFromSeq: activationChanged
            ? 0
            : Math.max(current.retainedFromSeq, events[0]?.seq ?? 0),
          nextSeq: Math.max(activationChanged ? 0 : current.nextSeq, event.seq + 1),
          status: current.status === "loading" ? "loading" : "ready",
          error: undefined,
        };
      });
    },
    [requestedActivationId, sessionId],
  );

  const loadMore = useCallback(async () => {
    if (snapshot.loadingMore || !snapshot.hasMore || !snapshot.activationId) return;
    const expectedActivationId = snapshot.activationId;
    const afterSeq = snapshot.events.at(-1)?.seq ?? -1;
    setSnapshot((current) => ({ ...current, loadingMore: true }));
    try {
      const value = await listPiRpcSessionContextTrace({
        sessionId,
        ...(requestedActivationId ? { activationId: requestedActivationId } : {}),
        afterSeq,
        limit: 500,
      });
      setSnapshot((current) => {
        if (current.activationId !== expectedActivationId) return current;
        const merged = mergeEvents(current.events, value.events);
        const events = requestedActivationId
          ? merged
          : limitEvents(merged, eventWindowLimit(value.capabilities));
        return {
          ...current,
          activationId: value.activationId,
          events,
          retainedFromSeq: events[0]?.seq ?? value.retainedFromSeq,
          nextSeq: Math.max(current.nextSeq, value.nextSeq),
          hasMore: value.hasMore,
          loadingMore: false,
          source: current.source === "disk" ? "disk" : value.source,
          integrity: current.integrity === "verified" ? "verified" : value.integrity,
          capabilities: value.capabilities,
          status: "ready",
          error: undefined,
        };
      });
    } catch (error) {
      setSnapshot((current) => ({
        ...current,
        loadingMore: false,
        status: isPermissionError(error) ? "permission-required" : "error",
        error,
      }));
    }
  }, [requestedActivationId, sessionId, snapshot]);

  useEffect(() => {
    let active = true;
    const unsubscribe = requestedActivationId
      ? () => undefined
      : manager.subscribeSessionContextTrace(acceptLiveEvent);
    setSnapshot(initialSnapshot());

    const loadBaseline = async () => {
      let activationId: string | undefined;
      let afterSeq = -1;
      let events: SessionContextTraceEventSummary[] = [];
      let retainedFromSeq = 0;
      let nextSeq = 0;
      let hasMore = false;
      let source: "memory" | "disk" | undefined;
      let integrity: "memory" | "verified" | undefined;
      let capabilities: SessionContextTraceCapabilities | undefined;

      // The hot ring needs at most two 500-item pages. A durable current activation can replay
      // up to four pages when its journal restores history or legacy prompt summaries. Historical
      // activations start with one page and expose an explicit load-more action.
      const maximumPages = requestedActivationId ? 1 : 4;
      for (let page = 0; page < maximumPages; page += 1) {
        const value = await listPiRpcSessionContextTrace({
          sessionId,
          ...(requestedActivationId ? { activationId: requestedActivationId } : {}),
          afterSeq,
          limit: 500,
        });
        if (!active) return;

        if (activationId && activationId !== value.activationId) {
          activationId = value.activationId;
          afterSeq = -1;
          events = [];
          retainedFromSeq = value.retainedFromSeq;
          nextSeq = value.nextSeq;
          source = value.source;
          integrity = value.integrity;
          capabilities = value.capabilities;
          continue;
        }

        activationId = value.activationId;
        retainedFromSeq = value.retainedFromSeq;
        nextSeq = value.nextSeq;
        hasMore = value.hasMore;
        source = source === "disk" ? "disk" : value.source;
        integrity = integrity === "verified" ? "verified" : value.integrity;
        capabilities = value.capabilities;
        events = mergeEvents(events, value.events);
        if (!value.hasMore || value.events.length === 0) break;
        afterSeq = value.events.at(-1)?.seq ?? afterSeq;
      }

      if (!active || !activationId) return;
      setSnapshot((current) => {
        if (current.activationId && current.activationId !== activationId) return current;
        const merged = mergeEvents(events, current.events);
        const loadedEvents = requestedActivationId
          ? merged
          : limitEvents(merged, eventWindowLimit(capabilities));
        return {
          activationId,
          events: loadedEvents,
          retainedFromSeq: loadedEvents[0]?.seq ?? retainedFromSeq,
          nextSeq: Math.max(nextSeq, current.nextSeq),
          hasMore,
          loadingMore: false,
          source,
          integrity,
          capabilities,
          status: "ready",
          loadMore: EMPTY_LOAD_MORE,
        };
      });
    };

    void loadBaseline().catch((error: unknown) => {
      if (!active) return;
      setSnapshot((current) => ({
        ...current,
        status: isPermissionError(error) ? "permission-required" : "error",
        error,
      }));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [acceptLiveEvent, manager, refreshRevision, requestedActivationId, sessionId]);

  return { ...snapshot, loadMore };
}
