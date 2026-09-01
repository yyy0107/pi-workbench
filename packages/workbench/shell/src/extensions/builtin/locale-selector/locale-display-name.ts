import type { Locale } from "@workbench/contracts/locale";

export function createLocaleDisplayName(displayLocale: Locale): (locale: Locale) => string {
  const displayNames = new Intl.DisplayNames(displayLocale, { type: "language" });
  return (locale) => {
    const language = new Intl.Locale(locale).language;
    return displayNames.of(language) ?? language;
  };
}
