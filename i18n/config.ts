import { SUPPORTED_LOCALES, isLocale, type Locale } from "@workbench/contracts/locale";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isLocale,
  type Locale,
} from "@workbench/contracts/locale";

export const LOCALE_COOKIE_NAME = "workbench_locale";

export function matchLocale(value: string | null | undefined): Locale | undefined {
  if (!value) return undefined;
  if (isLocale(value)) return value;

  const language = value.toLowerCase().split("-")[0];
  return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase().split("-")[0] === language);
}
