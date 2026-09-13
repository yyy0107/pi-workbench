import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
  createI18n,
  type CatalogTranslate,
  type StaticMessageKeyOf,
  type Locale,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const statusUiTranslationBundle = defineTranslationBundle({
  id: "workbench.pi-status-ui",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const definePiMessage = createTranslationBundleMessageFactory(statusUiTranslationBundle);
export type PiTranslate = CatalogTranslate<typeof enUS>;
export type PiStaticMessageKey = StaticMessageKeyOf<typeof enUS>;
export function createPiI18n(locale: Locale) {
  const runtime = createI18n(locale, [statusUiTranslationBundle]);
  return { ...runtime, ...runtime.forBundle(statusUiTranslationBundle) };
}
export type PiI18nRuntime = ReturnType<typeof createPiI18n>;
