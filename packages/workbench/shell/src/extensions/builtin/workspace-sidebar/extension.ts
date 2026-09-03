import { HouseIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";

import { defineMessage } from "../../../i18n";
import { WorkspaceSidebarSection } from "../../../sidebar/workspace-sidebar-section";

export const workspaceSidebarExtension = defineExtension({
  id: "workbench.workspace-sidebar",
  name: "Workspace Sidebar",
  version: "1.0.0",
  setup(context) {
    return context.sidebarSections.register({
      id: "workspace",
      title: defineMessage("workbench.shell.workspace"),
      icon: HouseIcon,
      component: WorkspaceSidebarSection,
      order: 0,
      search: {
        label: defineMessage("workbench.sidebar.search"),
        placeholder: defineMessage("workbench.sidebar.searchPlaceholder"),
      },
    });
  },
});
