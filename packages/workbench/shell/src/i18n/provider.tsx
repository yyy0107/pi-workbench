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
import { createI18n, type Translate } from "./runtime";
import type { CatalogTranslate, I18nRuntime, TranslationBundle } from "./types";
import { useWorkbenchSettingsService } from "../settings";

interface I18nContextValue extends I18nRuntime<Translate> {
  setLocale(locale: Locale): void;
  isLocalizableText: ReturnType<typeof createI18n>["isLocalizableText"];
  text: ReturnType<typeof createI18n>["text"];
  forBundle: ReturnType<typeof createI18n>["forBundle"];
}

const I18nContext = createContext<I18nContextValue | null>(null);

const EMPTY_TRANSLATION_BUNDLES: readonly TranslationBundle[] = Object.freeze([]);

function hasSameBundleInstallation(
  installed: readonly TranslationBundle[],
  next: readonly TranslationBundle[],
): boolean {
  return (
    installed.length === next.length && installed.every((bundle, index) => bundle === next[index])
  );
}

export function I18nProvider({
  bundles = EMPTY_TRANSLATION_BUNDLES,
  children,
  initialLocale,
}: Readonly<{
  bundles?: readonly TranslationBundle[];
  children: ReactNode;
  initialLocale: Locale;
}>) {
  const settings = useWorkbenchSettingsService();
  const [locale, setLocaleState] = useState(initialLocale);
  const localRevision = useRef(0);
  const hydration = useRef<ReturnType<typeof settings.load> | null>(null);
  const installedBundles = useRef(bundles);
  if (!hasSameBundleInstallation(installedBundles.current, bundles)) {
    throw new Error("I18nProvider translation bundles cannot change after the provider is mounted");
  }
  const runtime = useMemo(() => createI18n(locale, installedBundles.current), [locale]);

  const setLocale = useCallback(
    (nextLocale: Locale) => {
      localRevision.current += 1;
      setLocaleState(nextLocale);
      document.documentElement.lang = nextLocale;
      document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
      void settings.update({ locale: nextLocale }).catch(() => undefined);
    },
    [settings],
  );

  useEffect(() => {
    let active = true;
    const hydrationRevision = localRevision.current;
    const hydrationRequest = (hydration.current ??= Promise.resolve().then(() => settings.load()));
    void (async () => {
      try {
        const preferences = await hydrationRequest;
        if (!active) return;
        if (preferences.locale) {
          if (localRevision.current === hydrationRevision) {
            setLocaleState(preferences.locale);
            document.documentElement.lang = preferences.locale;
          }
        } else if (localRevision.current === hydrationRevision) {
          await settings.update({ locale: initialLocale });
          if (!active) return;
        }
        if (!active) return;
        document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
      } catch {
        // A settings transport failure keeps the request-provided locale for this installation.
      }
    })();
    return () => {
      active = false;
    };
  }, [initialLocale, settings]);

  const value = useMemo<I18nContextValue>(
    () => ({
      ...runtime,
      setLocale,
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

export function useTranslationBundle<TCatalog extends object>(
  bundle: TranslationBundle<TCatalog>,
): I18nRuntime<CatalogTranslate<TCatalog>> {
  const i18n = useI18n();
  return useMemo(() => i18n.forBundle(bundle), [bundle, i18n]);
}
