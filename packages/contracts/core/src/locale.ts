/** Canonical locale contract shared by the UI, persistence, and RPC boundaries. */
export const SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en-US";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.some((locale) => locale === value);
}
