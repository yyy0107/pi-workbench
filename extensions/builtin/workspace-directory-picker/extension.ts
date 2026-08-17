import { defineExtension } from "@/platform/extensions";

import { DirectoryPickerButton } from "./directory-picker-button";
import { WorkspaceDirectoryList } from "./workspace-directory-list";

export const workspaceDirectoryPickerExtension = defineExtension({
  id: "workbench.workspace-directory-picker",
  name: "Workspace Directory Picker",
  version: "1.0.0",

  setup(context) {
    const picker = context.slots.register("sidebar.workspace.actions", {
      id: "workbench.workspace-directory-picker.sidebar-action",
      order: 10,
      component: DirectoryPickerButton,
    });
    const list = context.slots.register("sidebar.top", {
      id: "workbench.workspace-directory-picker.sidebar-list",
      order: 10,
      component: WorkspaceDirectoryList,
    });

    return [picker, list];
  },
});
