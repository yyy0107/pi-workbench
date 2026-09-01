import { defineTranslationBundle } from "@workbench/shell/i18n/runtime";

import { appEnUS } from "./en-US";
import { appZhCN } from "./zh-CN";

/** Product-entry copy owned by the Web application rather than the reusable Shell. */
export const webAppTranslationBundle = defineTranslationBundle({
  id: "workbench.web-app",
  messages: {
    "en-US": { app: appEnUS },
    "zh-CN": { app: appZhCN },
  },
});
