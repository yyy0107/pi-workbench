import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { uiEnUS } from "./i18n/en-US";
import { uiZhCN } from "./i18n/zh-CN";
export const uiTranslationBundle = defineTranslationBundle({
  id: "workbench.ui",
  messages: { "en-US": { ui: uiEnUS }, "zh-CN": { ui: uiZhCN } },
});
