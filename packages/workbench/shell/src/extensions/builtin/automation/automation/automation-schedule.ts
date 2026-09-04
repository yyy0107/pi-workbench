import cronstrue from "cronstrue";
import "cronstrue/locales/zh_CN.js";

export const SCHEDULE_FREQUENCIES = [
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "custom",
] as const;

export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export interface ParsedScheduleCron {
  frequency: ScheduleFrequency;
  time: string;
  customCron: string;
}

export function describeScheduleCron(cron: string, locale: string): string | undefined {
  const expression = cron.trim();
  if (!expression) return undefined;

  try {
    return cronstrue.toString(expression, {
      locale: locale === "zh-CN" ? "zh_CN" : "en",
      throwExceptionOnParseError: true,
      use24HourTimeFormat: true,
    });
  } catch {
    return undefined;
  }
}

export function scheduleCron(
  frequency: ScheduleFrequency,
  time: string,
  customCron: string,
): string {
  const [hour = "9", minute = "0"] = time.split(":");
  switch (frequency) {
    case "hourly":
      return "0 * * * *";
    case "daily":
      return `${Number(minute)} ${Number(hour)} * * *`;
    case "weekdays":
      return `${Number(minute)} ${Number(hour)} * * 1-5`;
    case "weekly":
      return `${Number(minute)} ${Number(hour)} * * 1`;
    case "monthly":
      return `${Number(minute)} ${Number(hour)} 1 * *`;
    case "custom":
      return customCron.trim();
  }
}

export function parseScheduleCron(cron: string): ParsedScheduleCron {
  const normalized = cron.trim().replace(/\s+/g, " ");
  if (normalized === "0 * * * *") {
    return { frequency: "hourly", time: "09:00", customCron: "" };
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek, ...extra] = normalized.split(" ");
  const minuteValue = Number(minute);
  const hourValue = Number(hour);
  const fixedTime =
    extra.length === 0 &&
    Number.isInteger(minuteValue) &&
    minuteValue >= 0 &&
    minuteValue <= 59 &&
    Number.isInteger(hourValue) &&
    hourValue >= 0 &&
    hourValue <= 23;
  if (!fixedTime || month !== "*") {
    return { frequency: "custom", time: "09:00", customCron: cron };
  }
  const time = `${String(hourValue).padStart(2, "0")}:${String(minuteValue).padStart(2, "0")}`;
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return { frequency: "daily", time, customCron: "" };
  }
  if (dayOfMonth === "*" && dayOfWeek === "1-5") {
    return { frequency: "weekdays", time, customCron: "" };
  }
  if (dayOfMonth === "*" && dayOfWeek === "1") {
    return { frequency: "weekly", time, customCron: "" };
  }
  if (dayOfMonth === "1" && dayOfWeek === "*") {
    return { frequency: "monthly", time, customCron: "" };
  }
  return { frequency: "custom", time: "09:00", customCron: cron };
}

export function timezoneOffset(timezone: string, locale: string): string {
  try {
    const part = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find(({ type }) => type === "timeZoneName");
    return part?.value ?? timezone;
  } catch {
    return timezone;
  }
}

type RelativeTimeFormatter = (value: number, unit: Intl.RelativeTimeFormatUnit) => string;

export function formatRelativeTimeUntil(
  targetAt: number,
  now: number,
  relativeTime: RelativeTimeFormatter,
): string {
  const delta = targetAt - now;
  if (delta <= 0) return relativeTime(0, "second");

  const minutes = delta / 60_000;
  if (minutes < 60) return relativeTime(Math.max(1, Math.round(minutes)), "minute");

  const hours = minutes / 60;
  if (hours < 48) return relativeTime(Math.max(1, Math.round(hours)), "hour");

  const days = hours / 24;
  if (days < 14) return relativeTime(Math.max(1, Math.round(days)), "day");

  const weeks = days / 7;
  if (weeks < 8) return relativeTime(Math.max(1, Math.round(weeks)), "week");

  return relativeTime(Math.max(1, Math.round(days / 30)), "month");
}
