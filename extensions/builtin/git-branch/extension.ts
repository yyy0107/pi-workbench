import { defineExtension } from "@/platform/extensions/authoring";

import { ComposerGitBranchSelector, HeaderGitBranchSelector } from "./git-branch-selector";

export const gitBranchExtension = defineExtension({
  id: "workbench.git-branch",
  name: "Git Branch",
  version: "1.0.0",

  setup(context) {
    const composerHeader = context.slots.register("composer.header.left", {
      id: "workbench.git-branch.composer-header",
      order: 20,
      component: ComposerGitBranchSelector,
    });
    const conversationHeader = context.slots.register("header.left", {
      id: "workbench.git-branch.conversation-header",
      order: 20,
      component: HeaderGitBranchSelector,
    });

    return [composerHeader, conversationHeader];
  },
});
