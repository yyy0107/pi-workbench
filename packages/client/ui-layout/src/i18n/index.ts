import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { layoutEnUS } from "./en-US";
import { layoutZhCN } from "./zh-CN";

export const layoutTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-layout",
  messages: { "en-US": layoutEnUS, "zh-CN": layoutZhCN },
});
