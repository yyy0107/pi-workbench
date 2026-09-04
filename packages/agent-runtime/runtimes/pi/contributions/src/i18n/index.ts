"use client";

import { useMemo } from "react";

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
  type WorkbenchI18nRuntime,
} from "@workbench/shell/i18n";

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

type PiStaticMessageKeyOf<TCatalog, TPrefix extends string = ""> = {
  [TKey in keyof TCatalog & string]: TCatalog[TKey] extends string
    ? `${TPrefix}${TKey}`
    : TCatalog[TKey] extends (...args: never[]) => string
      ? never
      : TCatalog[TKey] extends object
        ? PiStaticMessageKeyOf<TCatalog[TKey], `${TPrefix}${TKey}.`>
        : never;
}[keyof TCatalog & string];

export type PiStaticMessageKey = PiStaticMessageKeyOf<PiTranslationCatalog>;

export function usePiI18n(): PiI18nRuntime {
  const i18n = useI18n();
  const bundleRuntime = useTranslationBundle(piTranslationBundle);
  return useMemo(
    () =>
      Object.freeze({
        ...bundleRuntime,
        isLocalizableText: i18n.isLocalizableText,
        text: i18n.text,
      }),
    [bundleRuntime, i18n.isLocalizableText, i18n.text],
  );
}

export function createPiI18n(locale: Locale): PiI18nRuntime {
  const runtime = createI18n(locale, [piTranslationBundle]);
  return Object.freeze({
    ...runtime.forBundle(piTranslationBundle),
    isLocalizableText: runtime.isLocalizableText,
    text: runtime.text,
  });
}

/** Stable bundle-bound descriptor factory; it preserves Pi keys instead of widening to Shell. */
export const definePiMessage = createTranslationBundleMessageFactory(piTranslationBundle);

export type PiMessageAtPath<TKey extends PiMessageKey> = MessageAtPath<PiTranslationCatalog, TKey>;
