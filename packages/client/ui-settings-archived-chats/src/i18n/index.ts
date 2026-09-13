import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const uiSettingsArchivedChatsTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-settings-archived-chats",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineMessage = createTranslationBundleMessageFactory(
  uiSettingsArchivedChatsTranslationBundle,
);
