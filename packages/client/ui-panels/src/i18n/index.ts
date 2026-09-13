import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { panelsEnUS } from "./en-US";
import { panelsZhCN } from "./zh-CN";

export const panelsTranslationBundle = defineTranslationBundle({
  id: "workbench.ui-panels",
  messages: { "en-US": panelsEnUS, "zh-CN": panelsZhCN },
});
