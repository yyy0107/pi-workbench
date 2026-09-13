import type { UsageStatisticsDay } from "@workbench/agent-runtime-pi-protocol/rpc";

export type ActivityMode = "daily" | "weekly" | "cumulative";

// UTC arithmetic operates on calendar keys, so DST never skips or repeats a displayed day.
export function offsetDate(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export function usageDays(days: readonly UsageStatisticsDay[], today: string, count: number) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return Array.from({ length: count }, (_, index): UsageStatisticsDay => {
    const date = offsetDate(today, index - count + 1);
    return byDate.get(date) ?? { date, tokens: 0, messages: 0, models: [] };
  });
}

export function activityCalendar(
  days: readonly UsageStatisticsDay[],
  today: string,
  mode: ActivityMode,
) {
  const daily = usageDays(days, today, 365);
  const weekStart = (date: string) => offsetDate(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
  const weeks = new Map<string, number>();
  for (const day of days) {
    if (day.date > today) continue;
    const week = weekStart(day.date);
    weeks.set(week, (weeks.get(week) ?? 0) + day.tokens);
  }
  let cumulative = days.reduce((sum, day) => sum + (day.date < daily[0]!.date ? day.tokens : 0), 0);
  const values = daily.map((day) => {
    cumulative += day.tokens;
    return {
      ...day,
      value:
        mode === "cumulative"
          ? cumulative
          : mode === "weekly"
            ? (weeks.get(weekStart(day.date)) ?? 0)
            : day.tokens,
      week: weekStart(day.date),
    };
  });
  const leading = new Date(`${daily[0]!.date}T00:00:00Z`).getUTCDay();
  return { values, leading, columns: Math.ceil((leading + values.length) / 7) };
}

export function usageTrendSeries(days: readonly UsageStatisticsDay[], provider?: string) {
  const series = new Map<
    string,
    { id: string; provider: string; model: string; total: number; values: number[] }
  >();
  for (const [index, day] of days.entries()) {
    for (const model of day.models) {
      if (provider !== undefined && model.provider !== provider) continue;
      const id = JSON.stringify(
        provider === undefined ? [model.provider] : [model.provider, model.model],
      );
      const entry = series.get(id) ?? {
        id,
        provider: model.provider,
        model: provider === undefined ? "" : model.model,
        total: 0,
        values: Array<number>(days.length).fill(0),
      };
      entry.total += model.tokens;
      entry.values[index]! += model.tokens;
      series.set(id, entry);
    }
  }
  return [...series.values()].sort((a, b) => b.total - a.total);
}

export function smoothTrendPath(points: readonly { x: number; y: number }[]) {
  return points
    .map((point, index) => {
      const previous = points[index - 1];
      if (!previous) return `M ${point.x} ${point.y}`;
      // Horizontal handles join smoothly and stay within the daily values, including zero.
      const middle = (previous.x + point.x) / 2;
      return `C ${middle} ${previous.y} ${middle} ${point.y} ${point.x} ${point.y}`;
    })
    .join(" ");
}
