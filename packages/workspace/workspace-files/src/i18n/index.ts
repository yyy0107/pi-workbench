import { defineTranslationBundle } from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const filesTranslationBundle = defineTranslationBundle({
  id: "workbench.workspace-files",
  messages: { "en-US": { workspaceFiles: enUS }, "zh-CN": { workspaceFiles: zhCN } },
});
