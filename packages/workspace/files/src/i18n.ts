import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const filesTranslationBundle = defineTranslationBundle({
  id: "workbench.workspace-files",
  messages: { "en-US": { workspaceFiles: enUS }, "zh-CN": { workspaceFiles: zhCN } },
});
