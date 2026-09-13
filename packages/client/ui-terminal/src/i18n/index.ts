import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const terminalUiTranslationBundle = defineTranslationBundle({
  id: "workbench.terminal-ui",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineTerminalUiMessage = createTranslationBundleMessageFactory(
  terminalUiTranslationBundle,
);
