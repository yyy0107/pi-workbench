"use client";
import { bindPiI18nRuntime } from "../../lib/i18n-runtime";
import { sessionImportUiTranslationBundle } from "@workbench/pi-session-import-ui/i18n";
import { statusUiTranslationBundle } from "@workbench/pi-status-ui/i18n";
import { diagnosticsUiTranslationBundle } from "@workbench/pi-diagnostics-ui/i18n";
import { toolboxUiTranslationBundle } from "@workbench/pi-toolbox-ui/i18n";

import { useMemo } from "react";
import { piSettingsUiTranslationBundle } from "@workbench/pi-settings-ui/i18n";

import {
  createI18n,
  createTranslationBundleMessageFactory,
  defineTranslationBundle,
  useI18n,
  useTranslationBundle,
  type CatalogShape,
  type CatalogTranslate,
  type I18nRuntime,
  type Locale,
  type MessageAtPath,
  type MessageKeyOf,
  type StaticMessageKeyOf,
  type WorkbenchI18nRuntime,
} from "@workbench/i18n";

import { piExtensionsEnUS } from "./en-US";
import { piExtensionsZhCN } from "./zh-CN";

export const piTranslationBundle = defineTranslationBundle({
  id: "workbench.agent-runtime-pi-contributions",
  messages: {
    "en-US": piExtensionsEnUS,
    "zh-CN": piExtensionsZhCN satisfies CatalogShape<typeof piExtensionsEnUS>,
  },
});

export type PiTranslationCatalog = CatalogShape<typeof piExtensionsEnUS>;
export type PiMessageKey = MessageKeyOf<PiTranslationCatalog>;
export type PiTranslate = CatalogTranslate<PiTranslationCatalog>;
export type PiI18nRuntime = I18nRuntime<PiTranslate> &
  Pick<WorkbenchI18nRuntime, "isLocalizableText" | "text">;

export type PiStaticMessageKey = StaticMessageKeyOf<PiTranslationCatalog>;

export function usePiI18n(): PiI18nRuntime {
  const i18n = useI18n();
  const bundleRuntime = useTranslationBundle(piTranslationBundle);
  return useMemo(
    () => bindPiI18nRuntime(bundleRuntime, i18n),
    [bundleRuntime, i18n.isLocalizableText, i18n.text],
  );
}

export function createPiI18n(locale: Locale): PiI18nRuntime {
  const runtime = createI18n(locale, piTranslationBundles);
  return bindPiI18nRuntime(runtime.forBundle(piTranslationBundle), runtime);
}

/** Stable bundle-bound descriptor factory; it preserves Pi keys instead of widening to Shell. */
export const definePiMessage = createTranslationBundleMessageFactory(piTranslationBundle);

export type PiMessageAtPath<TKey extends PiMessageKey> = MessageAtPath<PiTranslationCatalog, TKey>;

export const piTranslationBundles = Object.freeze([
  sessionImportUiTranslationBundle,
  statusUiTranslationBundle,
  diagnosticsUiTranslationBundle,
  toolboxUiTranslationBundle,
  piTranslationBundle,
  piSettingsUiTranslationBundle,
]);
