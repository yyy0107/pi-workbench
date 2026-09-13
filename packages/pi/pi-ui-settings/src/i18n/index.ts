import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
  type CatalogTranslate,
  type StaticMessageKeyOf,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const piSettingsUiTranslationBundle = defineTranslationBundle({
  id: "workbench.pi-settings-ui",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const definePiSettingsMessage = createTranslationBundleMessageFactory(
  piSettingsUiTranslationBundle,
);
export type PiSettingsTranslate = CatalogTranslate<typeof enUS>;
export type PiSettingsStaticMessageKey = StaticMessageKeyOf<typeof enUS>;
