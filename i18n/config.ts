export const SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en-US";
export const LOCALE_COOKIE_NAME = "workbench_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string | null | undefined): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

export function matchLocale(value: string | null | undefined): Locale | undefined {
  if (!value) return undefined;
  if (isLocale(value)) return value;

  const language = value.toLowerCase().split("-")[0];
  return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase().split("-")[0] === language);
}
