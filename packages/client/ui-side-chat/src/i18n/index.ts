import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const uiSideChatTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-side-chat",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineMessage = createTranslationBundleMessageFactory(uiSideChatTranslationBundle);
