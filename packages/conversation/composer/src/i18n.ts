import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const composerTranslationBundle = defineTranslationBundle({
  id: "workbench.composer",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineComposerMessage =
  createTranslationBundleMessageFactory(composerTranslationBundle);
