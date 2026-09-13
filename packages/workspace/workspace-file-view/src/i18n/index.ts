import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const fileViewTranslationBundle = defineTranslationBundle({
  id: "workbench.workspace-file-view",
  messages: {
    "en-US": { extensions: { workspaceFile: enUS } },
    "zh-CN": { extensions: { workspaceFile: zhCN } },
  },
});
export const defineFileViewMessage =
  createTranslationBundleMessageFactory(fileViewTranslationBundle);
