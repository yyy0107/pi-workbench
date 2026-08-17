"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, type Locale } from "./config";
import { createI18n, resolveText, type LocalizableText, type Translate } from "./runtime";
import type { I18nRuntime } from "./types";

interface I18nContextValue extends I18nRuntime<Translate> {
  setLocale(locale: Locale): void;
  text(value: LocalizableText): string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: Readonly<{ children: ReactNode; initialLocale: Locale }>) {
  const [locale, setLocaleState] = useState(initialLocale);
  const runtime = useMemo(() => createI18n(locale), [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    document.documentElement.lang = nextLocale;
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      ...runtime,
      setLocale,
      text: (message) => resolveText(runtime.t, message),
    }),
    [runtime, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within an I18nProvider");
  return context;
}
