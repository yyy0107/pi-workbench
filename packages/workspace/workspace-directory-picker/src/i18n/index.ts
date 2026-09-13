import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const directoryPickerTranslationBundle = defineTranslationBundle({
  id: "workbench.directory-picker",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineDirectoryPickerMessage = createTranslationBundleMessageFactory(
  directoryPickerTranslationBundle,
);
