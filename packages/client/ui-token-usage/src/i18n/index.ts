import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
  type CatalogTranslate,
  type StaticMessageKeyOf,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";

export const tokenUsageTranslationBundle = defineTranslationBundle({
  id: "workbench.token-usage",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineTokenUsageMessage = createTranslationBundleMessageFactory(
  tokenUsageTranslationBundle,
);
export type TokenUsageTranslate = CatalogTranslate<typeof enUS>;
export type TokenUsageStaticMessageKey = StaticMessageKeyOf<typeof enUS>;
