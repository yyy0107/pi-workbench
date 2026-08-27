import type { Locale } from "@/contracts/locale";

export function createLocaleDisplayName(displayLocale: Locale): (locale: Locale) => string {
  const displayNames = new Intl.DisplayNames(displayLocale, { type: "language" });
  return (locale) => displayNames.of(locale) ?? locale;
}
