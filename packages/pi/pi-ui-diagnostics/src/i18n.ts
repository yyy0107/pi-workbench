import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
  createI18n,
  type CatalogTranslate,
  type StaticMessageKeyOf,
  type Locale,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const diagnosticsUiTranslationBundle = defineTranslationBundle({
  id: "workbench.pi-diagnostics-ui",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const definePiMessage = createTranslationBundleMessageFactory(
  diagnosticsUiTranslationBundle,
);
export type PiTranslate = CatalogTranslate<typeof enUS>;
export type PiStaticMessageKey = StaticMessageKeyOf<typeof enUS>;
export function createPiI18n(locale: Locale) {
  const runtime = createI18n(locale, [diagnosticsUiTranslationBundle]);
  return { ...runtime, ...runtime.forBundle(diagnosticsUiTranslationBundle) };
}
export type PiI18nRuntime = ReturnType<typeof createPiI18n>;
