"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  I18nProvider as InstalledI18nProvider,
  useI18n as useInstalledI18n,
  LOCALE_COOKIE_NAME,
  type Locale,
  type TranslationBundle,
} from "@workbench/i18n";
import { useWorkbenchSettingsService } from "@workbench/settings-runtime";
import { shellTranslationBundles, type WorkbenchI18nRuntime } from "./runtime";

const EMPTY_TRANSLATION_BUNDLES: readonly TranslationBundle[] = Object.freeze([]);

/** The Shell owns settings hydration and browser locale effects for its installation. */
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

  return (
    <InstalledI18nProvider
      locale={locale}
      onLocaleChange={setLocale}
      bundles={[...shellTranslationBundles, ...bundles]}
    >
      {children}
    </InstalledI18nProvider>
  );
}

/** Typed product view over the single installed i18n Context. */
export function useI18n(): WorkbenchI18nRuntime & { setLocale(locale: Locale): void } {
  return useInstalledI18n() as WorkbenchI18nRuntime & { setLocale(locale: Locale): void };
}
export { useTranslationBundle } from "@workbench/i18n";
