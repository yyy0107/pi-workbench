import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { layoutEnUS } from "./i18n/en-US";
import { layoutZhCN } from "./i18n/zh-CN";

export const layoutTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-layout",
  messages: { "en-US": layoutEnUS, "zh-CN": layoutZhCN },
});
