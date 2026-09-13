import { HouseIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";

import { defineSidebarMessage } from "./i18n";
import { WorkspaceSidebarSection } from "./workspace-sidebar-section";

export const workspaceSidebarExtension = defineExtension({
  id: "workbench.workspace-sidebar",
  name: "Workspace Sidebar",
  version: "1.0.0",
  setup(context) {
    return context.sidebarSections.register({
      id: "workspace",
      title: defineSidebarMessage("workbench.shell.workspace"),
      icon: HouseIcon,
      component: WorkspaceSidebarSection,
      order: 0,
      search: {
        label: defineSidebarMessage("workbench.sidebar.search"),
        placeholder: defineSidebarMessage("workbench.sidebar.searchPlaceholder"),
      },
    });
  },
});
