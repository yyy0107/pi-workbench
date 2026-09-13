import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
  type CatalogTranslate,
  type StaticMessageKeyOf,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";

export const modelSelectionTranslationBundle = defineTranslationBundle({
  id: "workbench.model-selection",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineModelSelectionMessage = createTranslationBundleMessageFactory(
  modelSelectionTranslationBundle,
);
export type ModelSelectionTranslate = CatalogTranslate<typeof enUS>;
export type ModelSelectionStaticMessageKey = StaticMessageKeyOf<typeof enUS>;
