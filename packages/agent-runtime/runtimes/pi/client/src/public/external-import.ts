"use client";

import { useMemo } from "react";

import { usePiSessionManager } from "../runtime/context";
import { importExternalSessions, scanExternalSessions } from "../transport/api";

/** Bind external-session import requests to the active installation. */
export function usePiExternalImportClient() {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    return {
      scan: () => scanExternalSessions(options),
      import: (payload: Parameters<typeof importExternalSessions>[0]) =>
        importExternalSessions(payload, options),
    };
  }, [manager]);
}
