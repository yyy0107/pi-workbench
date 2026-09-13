import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const browserTranslationBundle = defineTranslationBundle({
  id: "workbench.browser",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineBrowserMessage = createTranslationBundleMessageFactory(browserTranslationBundle);
