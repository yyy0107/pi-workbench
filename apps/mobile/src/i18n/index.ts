import {
  createTranslationBundleMessageFactory,
  defineTranslationBundle,
  type CatalogTranslate,
} from "@workbench/i18n/runtime";

import { messages as enUS } from "./en-US.ts";
import { messages as zhCN } from "./zh-CN.ts";

export const mobileTranslationBundle = defineTranslationBundle({
  id: "workbench.mobile",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineMobileMessage = createTranslationBundleMessageFactory(mobileTranslationBundle);
export type MobileTranslate = CatalogTranslate<typeof enUS>;
