import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const uiUserMessageIndexTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-user-message-index",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineMessage = createTranslationBundleMessageFactory(
  uiUserMessageIndexTranslationBundle,
);
