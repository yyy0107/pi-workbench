import { ToolboxIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";

import { definePiMessage } from "../../i18n";
import { ToolboxMainView } from "./toolbox-main-view";
import { ToolboxSidebar } from "./toolbox-sidebar";

export const toolboxExtension = defineExtension({
  id: "workbench.toolbox",
  name: "Toolbox",
  version: "1.0.0",
  setup(context) {
    const sidebar = context.sidebarSections.register({
      id: "toolbox",
      title: definePiMessage("extensions.toolbox.title"),
      icon: ToolboxIcon,
      component: ToolboxSidebar,
      order: 20,
      mainViewKinds: ["toolbox"],
      search: {
        label: definePiMessage("extensions.toolbox.sidebar.search"),
        placeholder: definePiMessage("extensions.toolbox.sidebar.searchPlaceholder"),
      },
    });
    const mainView = context.mainViews.register({
      kind: "toolbox",
      component: ToolboxMainView,
    });
    return [sidebar, mainView];
  },
});
