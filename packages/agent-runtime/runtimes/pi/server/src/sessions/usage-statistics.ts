import { readFile } from "node:fs/promises";
import { parseSessionEntries, type FileEntry } from "@earendil-works/pi-coding-agent";
import { readWorkbenchMessageUsage } from "@workbench/agent-runtime-contracts/message-metadata";
import type {
  UsageStatisticsDay,
  UsageStatisticsPayload,
  UsageStatisticsValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { listSessionFiles } from "./session-registry";

const DAY_MS = 86_400_000;

/** Aggregate native messages once; canonical event journals contain copies of the same messages. */
export async function aggregateUsageStatistics(
  sessions: AsyncIterable<readonly FileEntry[]>,
  timeZone: string,
  now = new Date(),
): Promise<UsageStatisticsValue> {
  // These parts form a protocol date key, independent of the UI's display locale.
  const calendar = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKey = (timestamp: number) => {
    const parts = calendar.formatToParts(timestamp);
    return ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)!.value)
      .join("-");
  };
  const days = new Map<string, UsageStatisticsDay>();
  const seen = new Set<string>();
  let longestChatMs = 0;

  for await (const entries of sessions) {
    let first = Infinity;
    let last = -Infinity;
    for (const entry of entries) {
      if (entry?.type !== "message" || !entry.message) continue;
      const message = entry.message;
      if (message.role !== "user" && message.role !== "assistant") continue;
      const timestamp = message.timestamp;
      if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > now.getTime()) continue;
      first = Math.min(first, timestamp);
      last = Math.max(last, timestamp);
      // Pi forks preserve entry IDs and timestamps. Count inherited messages only once,
      // while retaining all independently generated branches and retries.
      const identity = JSON.stringify([entry.id, timestamp, message.role]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const date = dayKey(timestamp);
      const day = days.get(date) ?? { date, tokens: 0, messages: 0, models: [] };
      days.set(date, day);
      day.messages += 1;
      if (message.role !== "assistant") continue;
      const usage = readWorkbenchMessageUsage(message.usage);
      if (!usage) continue;
      const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
      if (tokens === 0) continue;
      day.tokens += tokens;
      const provider = typeof message.provider === "string" ? message.provider : "";
      const model = typeof message.model === "string" ? message.model : "";
      const series = day.models.find((item) => item.provider === provider && item.model === model);
      if (series) series.tokens += tokens;
      else day.models.push({ provider, model, tokens });
    }
    if (Number.isFinite(first)) longestChatMs = Math.max(longestChatMs, last - first);
  }

  const orderedDays = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  let longestStreak = 0;
  let streak = 0;
  let previous = -Infinity;
  for (const day of orderedDays) {
    const ordinal = Date.parse(`${day.date}T00:00:00Z`) / DAY_MS;
    streak = ordinal === previous + 1 ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    previous = ordinal;
  }
  const today = dayKey(now.getTime());
  const todayOrdinal = Date.parse(`${today}T00:00:00Z`) / DAY_MS;
  return {
    generatedAt: now.toISOString(),
    today,
    timeZone,
    totalTokens: orderedDays.reduce((sum, day) => sum + day.tokens, 0),
    peakDailyTokens: orderedDays.reduce((peak, day) => Math.max(peak, day.tokens), 0),
    longestChatMs,
    currentStreak: todayOrdinal - previous <= 1 ? streak : 0,
    longestStreak,
    days: orderedDays,
  };
}

export async function readUsageStatistics(
  { timeZone }: UsageStatisticsPayload,
  signal: AbortSignal,
): Promise<UsageStatisticsValue> {
  async function* storedSessions() {
    // ponytail: parse one stored file at a time on demand; add fingerprint caching if scans become slow.
    for (const path of await listSessionFiles()) {
      signal.throwIfAborted();
      try {
        yield parseSessionEntries(await readFile(path, { encoding: "utf8", signal }));
      } catch (error) {
        // A conversation can be deleted after the catalog snapshot was taken.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return aggregateUsageStatistics(storedSessions(), timeZone);
}
