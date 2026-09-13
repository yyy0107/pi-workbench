import { setImmediate as yieldToRuntime } from "node:timers/promises";
import type { FileEntry } from "@earendil-works/pi-coding-agent";
import { readWorkbenchMessageUsage } from "@workbench/agent-runtime-contracts/message-metadata";
import type {
  UsageStatisticsDay,
  UsageStatisticsValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";

const DAY_MS = 86_400_000;

export interface UsageMessage {
  identity: string;
  timestamp: number;
  tokens: number;
  provider: string;
  model: string;
}

export function usageMessages(entries: readonly FileEntry[]): UsageMessage[] {
  const messages: UsageMessage[] = [];
  for (const entry of entries) {
    if (entry?.type !== "message" || !entry.message) continue;
    const message = entry.message;
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!Number.isFinite(message.timestamp) || message.timestamp < 0) continue;
    const usage = message.role === "assistant" && readWorkbenchMessageUsage(message.usage);
    messages.push({
      identity: JSON.stringify([entry.id, message.timestamp, message.role]),
      timestamp: message.timestamp,
      tokens: usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite : 0,
      provider:
        message.role === "assistant" && typeof message.provider === "string"
          ? message.provider
          : "",
      model: message.role === "assistant" && typeof message.model === "string" ? message.model : "",
    });
  }
  return messages;
}

/** Aggregate native messages once; canonical event journals contain copies of the same messages. */
export async function aggregateUsageStatistics(
  sessions: AsyncIterable<readonly UsageMessage[]>,
  timeZone: string,
  now = new Date(),
  signal?: AbortSignal,
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
  let processed = 0;

  for await (const entries of sessions) {
    let first = Infinity;
    let last = -Infinity;
    for (const message of entries) {
      if (++processed % 2000 === 0) {
        await yieldToRuntime();
        signal?.throwIfAborted();
      }
      const { timestamp, identity, tokens, provider, model } = message;
      if (timestamp > now.getTime()) continue;
      first = Math.min(first, timestamp);
      last = Math.max(last, timestamp);
      // Pi forks preserve entry IDs and timestamps. Count inherited messages only once,
      // while retaining all independently generated branches and retries.
      if (seen.has(identity)) continue;
      seen.add(identity);
      const date = dayKey(timestamp);
      const day = days.get(date) ?? { date, tokens: 0, messages: 0, models: [] };
      days.set(date, day);
      day.messages += 1;
      if (tokens === 0) continue;
      day.tokens += tokens;
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
