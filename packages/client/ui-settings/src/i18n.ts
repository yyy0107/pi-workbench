import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const settingsUiTranslationBundle = defineTranslationBundle({
  id: "workbench.settings-ui",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineSettingsUiMessage = createTranslationBundleMessageFactory(
  settingsUiTranslationBundle,
);
