"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { LOCALE_COOKIE_NAME, type Locale } from "./config";
import { createI18n, resolveText, type LocalizableText, type Translate } from "./runtime";
import type { I18nRuntime } from "./types";
import {
  loadWorkbenchSettingsPreferences,
  updateWorkbenchSettingsPreferences,
} from "@/services/workbench-settings-service";

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
  const localRevision = useRef(0);
  const runtime = useMemo(() => createI18n(locale), [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    localRevision.current += 1;
    setLocaleState(nextLocale);
    document.documentElement.lang = nextLocale;
    document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
    void updateWorkbenchSettingsPreferences({ locale: nextLocale }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const hydrationRevision = localRevision.current;
    void loadWorkbenchSettingsPreferences()
      .then(async (preferences) => {
        if (preferences.locale) {
          if (localRevision.current === hydrationRevision) {
            setLocaleState(preferences.locale);
            document.documentElement.lang = preferences.locale;
          }
        } else if (localRevision.current === hydrationRevision) {
          await updateWorkbenchSettingsPreferences({ locale: initialLocale });
        }
        document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
      })
      .catch(() => undefined);
  }, [initialLocale]);

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
