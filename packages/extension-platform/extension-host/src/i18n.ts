import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { platformExtensionsEnUS } from "./i18n/en-US";
import { platformExtensionsZhCN } from "./i18n/zh-CN";

export const platformExtensionsTranslationBundle = defineTranslationBundle({
  id: "workbench.extension-host",
  messages: {
    "en-US": { platform: { extensions: platformExtensionsEnUS } },
    "zh-CN": { platform: { extensions: platformExtensionsZhCN } },
  },
});
