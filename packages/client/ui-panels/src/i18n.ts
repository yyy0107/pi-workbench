import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { panelsEnUS } from "./i18n/en-US";
import { panelsZhCN } from "./i18n/zh-CN";

export const panelsTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-panels",
  messages: { "en-US": panelsEnUS, "zh-CN": panelsZhCN },
});
