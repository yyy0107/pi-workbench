import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const codeHighlightingTranslationBundle = defineTranslationBundle({
  id: "workbench.code-highlighting",
  messages: { "en-US": { codeHighlighting: enUS }, "zh-CN": { codeHighlighting: zhCN } },
});
