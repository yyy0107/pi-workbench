import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { platformExtensionsEnUS } from "./en-US";
import { platformExtensionsZhCN } from "./zh-CN";

export const platformExtensionsTranslationBundle = defineTranslationBundle({
  id: "workbench.extension-host",
  messages: {
    "en-US": { platform: { extensions: platformExtensionsEnUS } },
    "zh-CN": { platform: { extensions: platformExtensionsZhCN } },
  },
});
