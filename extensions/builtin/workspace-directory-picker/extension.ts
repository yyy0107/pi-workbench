import { defineExtension } from "@/platform/extensions";

import { DirectoryPickerButton } from "./directory-picker-button";
import { NewThreadNavigationItem } from "./new-thread-navigation-item";
import { WorkspaceDirectorySummary } from "./workspace-directory-summary";

export const workspaceDirectoryPickerExtension = defineExtension({
  id: "workbench.workspace-directory-picker",
  name: "Workspace Directory Picker",
  version: "1.0.0",

  setup(context) {
    const newThread = context.slots.register("sidebar.navigation", {
      id: "workbench.workspace-directory-picker.new-thread-navigation",
      order: 0,
      component: NewThreadNavigationItem,
    });
    const picker = context.slots.register("sidebar.workspace.actions", {
      id: "workbench.workspace-directory-picker.sidebar-action",
      order: 10,
      component: DirectoryPickerButton,
    });
    const composerSummary = context.slots.register("composer.drawer.left", {
      id: "workbench.workspace-directory-picker.composer-drawer",
      order: 10,
      component: WorkspaceDirectorySummary,
    });

    return [newThread, picker, composerSummary];
  },
});
