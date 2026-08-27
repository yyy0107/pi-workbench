import { defineExtension } from "@/platform/extensions/authoring";

import { DirectoryPickerButton } from "./directory-picker-button";
import { NewThreadWorkspaceItem } from "./new-thread-workspace-item";
import { WorkspaceDirectorySummary } from "./workspace-directory-summary";

export const workspaceDirectoryPickerExtension = defineExtension({
  id: "workbench.workspace-directory-picker",
  name: "Workspace Directory Picker",
  version: "1.0.0",

  setup(context) {
    const newThread = context.slots.register("sidebar.top", {
      id: "workbench.workspace-directory-picker.new-thread-workspace",
      order: 0,
      component: NewThreadWorkspaceItem,
    });
    const picker = context.slots.register("sidebar.workspace.actions", {
      id: "workbench.workspace-directory-picker.sidebar-action",
      order: 10,
      component: DirectoryPickerButton,
    });
    const composerHeader = context.slots.register("composer.header.left", {
      id: "workbench.workspace-directory-picker.composer-header",
      order: 10,
      component: WorkspaceDirectorySummary,
    });

    return [newThread, picker, composerHeader];
  },
});
