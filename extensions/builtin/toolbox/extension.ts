import { defineExtension } from "@/platform/extensions/authoring";

import { ToolboxMainView } from "./toolbox-main-view";
import { ToolboxSidebar } from "./toolbox-sidebar";

export const toolboxExtension = defineExtension({
  id: "workbench.toolbox",
  name: "Toolbox",
  version: "1.0.0",
  setup(context) {
    const sidebar = context.slots.register("sidebar.toolbox", {
      id: "workbench.toolbox.sidebar",
      component: ToolboxSidebar,
    });
    const mainView = context.mainViews.register({
      kind: "toolbox",
      component: ToolboxMainView,
    });
    return [sidebar, mainView];
  },
});
