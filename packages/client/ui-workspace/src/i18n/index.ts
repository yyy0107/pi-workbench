import {
  defineTranslationBundle,
  createTranslationBundleMessageFactory,
} from "@workbench/i18n/runtime";
import { rightWorkspaceEnUS } from "./en-US";
import { rightWorkspaceZhCN } from "./zh-CN";
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
