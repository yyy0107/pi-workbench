import {
  createTranslationBundleMessageFactory,
  defineTranslationBundle,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";

export const sidebarTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-sidebar",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});

export const defineSidebarMessage = createTranslationBundleMessageFactory(sidebarTranslationBundle);
