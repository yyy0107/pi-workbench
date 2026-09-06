"use client";

import { useMemo } from "react";
import type { UsageStatisticsValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import { usePiSessionManager } from "../runtime/context";
import { fetchUsageStatistics } from "../transport/api";

const snapshots = new WeakMap<object, UsageStatisticsValue>();

export function usePiUsageStatisticsClient() {
  const manager = usePiSessionManager();
  return useMemo(
    () => ({
      getSnapshot: (timeZone: string) => {
        const value = snapshots.get(manager);
        return value?.timeZone === timeZone ? value : undefined;
      },
      read: async (timeZone: string, signal: AbortSignal) => {
        const value = await fetchUsageStatistics(
          { timeZone },
          {
            ...manager.rpcTransportOptions,
            signal,
          },
        );
        if (!signal.aborted) snapshots.set(manager, value);
        return value;
      },
    }),
    [manager],
  );
}
