"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import type { Locale } from "./config";
import { createI18n, type WorkbenchI18nRuntime } from "./runtime";
import type { CatalogTranslate, I18nRuntime, TranslationBundle } from "./types";

interface I18nContextValue extends WorkbenchI18nRuntime {
  setLocale(locale: Locale): void;
}
const I18nContext = createContext<I18nContextValue | null>(null);
const EMPTY_BUNDLES: readonly TranslationBundle[] = Object.freeze([]);

/** Locale effects belong to the installing application; this provider only composes translations. */
export function I18nProvider({
  locale,
  onLocaleChange,
  bundles = EMPTY_BUNDLES,
  children,
}: Readonly<{
  locale: Locale;
  onLocaleChange(locale: Locale): void;
  bundles?: readonly TranslationBundle[];
  children: ReactNode;
}>) {
  const installed = useRef(bundles);
  if (
    installed.current.length !== bundles.length ||
    installed.current.some((bundle, index) => bundle !== bundles[index])
  ) {
    throw new Error("I18nProvider translation bundles cannot change after the provider is mounted");
  }
  const runtime = useMemo(() => createI18n(locale, installed.current), [locale]);
  const value = useMemo(
    () => ({ ...runtime, setLocale: onLocaleChange }),
    [runtime, onLocaleChange],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

type BundleI18nContextValue<TCatalog extends object> = Omit<I18nContextValue, "t"> &
  I18nRuntime<CatalogTranslate<TCatalog>>;

export function useI18n(): I18nContextValue;
export function useI18n<TCatalog extends object>(
  bundle: TranslationBundle<TCatalog>,
): BundleI18nContextValue<TCatalog>;
/** Bind local keys while retaining installed descriptor resolution and locale controls. */
export function useI18n(bundle?: TranslationBundle): unknown {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within an I18nProvider");
  return useMemo(
    () => (bundle ? { ...context, ...context.forBundle(bundle) } : context),
    [bundle, context],
  );
}

export function useTranslationBundle<TCatalog extends object>(
  bundle: TranslationBundle<TCatalog>,
): I18nRuntime<CatalogTranslate<TCatalog>> {
  const runtime = useI18n();
  return useMemo(() => runtime.forBundle(bundle), [bundle, runtime]);
}
