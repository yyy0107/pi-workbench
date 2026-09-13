import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const markdownTranslationBundle = defineTranslationBundle({
  id: "workbench.markdown",
  messages: { "en-US": { markdown: enUS }, "zh-CN": { markdown: zhCN } },
});
