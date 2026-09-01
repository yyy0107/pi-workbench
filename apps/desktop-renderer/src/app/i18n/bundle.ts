import { defineTranslationBundle } from "@workbench/shell/i18n/runtime";

import { desktopRendererEnUS } from "./en-US";
import { desktopRendererZhCN } from "./zh-CN";

/** Product-entry copy owned by the static Desktop renderer. */
export const desktopRendererTranslationBundle = defineTranslationBundle({
  id: "workbench.desktop-renderer",
  messages: {
    "en-US": { desktopRenderer: desktopRendererEnUS },
    "zh-CN": { desktopRenderer: desktopRendererZhCN },
  },
});
