"use client";

import { useMemo } from "react";
import { usePiSessionManager } from "../runtime/context";
import { fetchUsageStatistics } from "../transport/api";

export function usePiUsageStatisticsClient() {
  const manager = usePiSessionManager();
  return useMemo(
    () => ({
      read: (timeZone: string, signal: AbortSignal) =>
        fetchUsageStatistics(
          { timeZone },
          {
            ...manager.rpcTransportOptions,
            signal,
          },
        ),
    }),
    [manager],
  );
}
