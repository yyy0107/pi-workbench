import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { messages as enUS } from "./en-US";
import { messages as zhCN } from "./zh-CN";
export const gitBranchTranslationBundle = defineTranslationBundle({
  id: "workbench.git-branch",
  messages: { "en-US": enUS, "zh-CN": zhCN },
});
export const defineGitBranchMessage = createTranslationBundleMessageFactory(
  gitBranchTranslationBundle,
);
