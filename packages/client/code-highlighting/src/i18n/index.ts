import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const codeHighlightingTranslationBundle = defineTranslationBundle({
  id: "workbench.code-highlighting",
  messages: { "en-US": { codeHighlighting: enUS }, "zh-CN": { codeHighlighting: zhCN } },
});
