import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
  type CatalogTranslate,
  type StaticMessageKeyOf,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";

export const piSettingsModelsTranslationBundle = defineTranslationBundle({
  id: "workbench.pi-settings-models",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const definePiSettingsModelsMessage = createTranslationBundleMessageFactory(
  piSettingsModelsTranslationBundle,
);
export type PiSettingsModelsTranslate = CatalogTranslate<typeof enUS>;
export type PiSettingsModelsStaticMessageKey = StaticMessageKeyOf<typeof enUS>;
