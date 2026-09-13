import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
  type CatalogTranslate,
  type StaticMessageKeyOf,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";

export const settingsGeneralTranslationBundle = defineTranslationBundle({
  id: "workbench.settings-general",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineSettingsGeneralMessage = createTranslationBundleMessageFactory(
  settingsGeneralTranslationBundle,
);
export type SettingsGeneralTranslate = CatalogTranslate<typeof enUS>;
export type SettingsGeneralStaticMessageKey = StaticMessageKeyOf<typeof enUS>;
