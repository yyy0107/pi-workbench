import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { rightWorkspaceEnUS } from "./i18n/en-US";
import { rightWorkspaceZhCN } from "./i18n/zh-CN";
export const workspaceTranslationBundle = defineTranslationBundle({
  id: "workbench.workspace-runtime",
  messages: {
    "en-US": { rightWorkspace: rightWorkspaceEnUS },
    "zh-CN": { rightWorkspace: rightWorkspaceZhCN },
  },
});
export const defineWorkspaceMessage = createTranslationBundleMessageFactory(
  workspaceTranslationBundle,
);
