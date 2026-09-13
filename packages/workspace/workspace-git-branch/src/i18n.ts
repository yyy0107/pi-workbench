import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./i18n/en-US";
import { messages as zhCN } from "./i18n/zh-CN";
export const gitBranchTranslationBundle = defineTranslationBundle({
  id: "workbench.git-branch",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineGitBranchMessage = createTranslationBundleMessageFactory(
  gitBranchTranslationBundle,
);
