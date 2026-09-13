import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { uiEnUS } from "./en-US";
import { uiZhCN } from "./zh-CN";
export const uiTranslationBundle = defineTranslationBundle({
  id: "workbench.ui",
  messages: { "en-US": { ui: uiEnUS }, "zh-CN": { ui: uiZhCN } },
});
