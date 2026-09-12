import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { UsageStatisticsPayload } from "@workbench/agent-runtime-pi-protocol/rpc";
import { listSessionFiles } from "./session-registry";
import { UsageStatisticsStore } from "./usage-statistics-store";

export { aggregateUsageStatistics, usageMessages } from "./usage-statistics-aggregation";

let current: { root: string; store: UsageStatisticsStore } | undefined;

export function readUsageStatistics(payload: UsageStatisticsPayload, signal: AbortSignal) {
  const root = path.resolve(getAgentDir(), "sessions");
  if (current?.root !== root) {
    current = { root, store: new UsageStatisticsStore(root, listSessionFiles) };
  }
  return current.store.read(payload, signal);
}
