import { createElement, type ReactNode } from "react";
import { I18nProvider as SharedI18nProvider } from "@workbench/i18n";
import { createI18n as createRuntime, type Locale } from "@workbench/i18n/runtime";
import { todoTranslationBundle, defineMessage } from "../src/i18n";
const bundles = [todoTranslationBundle];
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  return createElement(SharedI18nProvider, {
    locale: initialLocale,
    onLocaleChange: () => {},
    bundles,
    children,
  });
}
export function createI18n(locale: Locale) {
  return createRuntime(locale, bundles);
}
export { defineMessage };
