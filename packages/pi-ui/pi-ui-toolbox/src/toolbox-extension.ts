import { ToolboxIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";

import { definePiMessage } from "./i18n";
import { ToolboxComposerShortcuts } from "./toolbox-composer-shortcuts";
import { ToolboxMainView } from "./toolbox-main-view";
import { ToolboxSidebar } from "./toolbox-sidebar";
import {
  createPiResourceFileOpenersBinding,
  createPiResourceFileOpenersContribution,
  registerPiResourceFileOpeners,
} from "./pi-resource-file-openers-bridge";

export const toolboxExtension = defineExtension({
  id: "workbench.toolbox",
  name: "Toolbox",
  version: "1.0.0",
  setup(context) {
    const binding = createPiResourceFileOpenersBinding();
    const openers = registerPiResourceFileOpeners(context.openers, binding, context.workspace);
    const resourceBridge = context.slots.register("shell.overlay", {
      id: "workbench.toolbox.file-openers",
      component: createPiResourceFileOpenersContribution(binding),
    });
    const sidebar = context.sidebarSections.register({
      id: "toolbox",
      title: definePiMessage("extensions.toolbox.title"),
      icon: ToolboxIcon,
      component: ToolboxSidebar,
      order: 20,
      mainViewKinds: ["toolbox", "system-prompts"],
    });
    const mainView = context.mainViews.register({
      kind: "toolbox",
      component: ToolboxMainView,
    });
    const composerShortcuts = context.slots.register("composer.header.right", {
      id: "workbench.toolbox.composer-shortcuts",
      order: 10,
      component: ToolboxComposerShortcuts,
    });
    return [sidebar, mainView, openers, resourceBridge, composerShortcuts];
  },
});
