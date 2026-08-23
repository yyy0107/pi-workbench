"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PiApiError } from "../transport/api";

import { usePiActiveSessionId } from "./context";

export type PiSessionCatalogLoadState = "idle" | "loading" | "ready" | "failed";

export interface PiSessionCatalog<T> {
  readonly sessionId: string | undefined;
  readonly value: T;
  readonly loadState: PiSessionCatalogLoadState;
  readonly sessionUnavailable: boolean;
  readonly refresh: () => void;
}

export interface PiSessionCatalogState<T> {
  readonly requestId: number;
  readonly sessionId: string | undefined;
  readonly value: T;
  readonly loadState: PiSessionCatalogLoadState;
  readonly sessionUnavailable: boolean;
}

export type PiSessionCatalogEvent<T> =
  | { readonly type: "begin"; readonly requestId: number; readonly sessionId?: string }
  | {
      readonly type: "succeed";
      readonly requestId: number;
      readonly sessionId: string;
      readonly value: T;
    }
  | {
      readonly type: "fail";
      readonly requestId: number;
      readonly sessionId: string;
      readonly sessionUnavailable: boolean;
    };

export function createPiSessionCatalogState<T>(emptyValue: T): PiSessionCatalogState<T> {
  return {
    requestId: 0,
    sessionId: undefined,
    value: emptyValue,
    loadState: "idle",
    sessionUnavailable: false,
  };
}

export function transitionPiSessionCatalog<T>(
  state: PiSessionCatalogState<T>,
  event: PiSessionCatalogEvent<T>,
  emptyValue: T,
): PiSessionCatalogState<T> {
  if (event.type === "begin") {
    return {
      requestId: event.requestId,
      sessionId: event.sessionId,
      value: emptyValue,
      loadState: event.sessionId ? "loading" : "idle",
      sessionUnavailable: false,
    };
  }
  if (state.requestId !== event.requestId || state.sessionId !== event.sessionId) return state;
  if (event.type === "succeed") {
    return { ...state, value: event.value, loadState: "ready", sessionUnavailable: false };
  }
  return {
    ...state,
    value: emptyValue,
    loadState: "failed",
    sessionUnavailable: event.sessionUnavailable,
  };
}

export function readPiSessionCatalog<T>(
  state: PiSessionCatalogState<T>,
  sessionId: string | undefined,
  emptyValue: T,
): Omit<PiSessionCatalog<T>, "refresh"> {
  if (state.sessionId === sessionId) {
    const { value, loadState, sessionUnavailable } = state;
    return { sessionId, value, loadState, sessionUnavailable };
  }
  return {
    sessionId,
    value: emptyValue,
    loadState: sessionId ? "loading" : "idle",
    sessionUnavailable: false,
  };
}

export function isPiSessionUnavailable(error: unknown): boolean {
  return error instanceof PiApiError && error.code === "session-not-found";
}

export function usePiSessionCatalog<T>(
  loader: (sessionId: string) => Promise<T>,
  emptyValue: T,
): PiSessionCatalog<T> {
  const sessionId = usePiActiveSessionId();
  const [state, setState] = useState<PiSessionCatalogState<T>>(() =>
    createPiSessionCatalogState(emptyValue),
  );
  const requestGeneration = useRef(0);

  const refresh = useCallback(() => {
    const requestId = ++requestGeneration.current;
    setState((current) =>
      transitionPiSessionCatalog(current, { type: "begin", requestId, sessionId }, emptyValue),
    );

    if (!sessionId) return;

    void loader(sessionId).then(
      (nextValue) => {
        if (requestGeneration.current !== requestId) return;
        setState((current) =>
          transitionPiSessionCatalog(
            current,
            { type: "succeed", requestId, sessionId, value: nextValue },
            emptyValue,
          ),
        );
      },
      (error: unknown) => {
        if (requestGeneration.current !== requestId) return;
        setState((current) =>
          transitionPiSessionCatalog(
            current,
            {
              type: "fail",
              requestId,
              sessionId,
              sessionUnavailable: isPiSessionUnavailable(error),
            },
            emptyValue,
          ),
        );
      },
    );
  }, [emptyValue, loader, sessionId]);

  useEffect(() => {
    refresh();
    return () => {
      requestGeneration.current += 1;
    };
  }, [refresh]);

  return { ...readPiSessionCatalog(state, sessionId, emptyValue), refresh };
}
