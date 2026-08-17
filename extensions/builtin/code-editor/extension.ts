import { defineExtension } from "@/platform/extensions";
import { defineMessage } from "@/i18n";

import { CodeEditorAddMenuItem } from "./code-editor-add-menu-item";
import { CodeEditorPanel } from "./code-editor-panel";
import { CodeEditorTab } from "./code-editor-tab";
import { toggleCodeEditorCommand } from "./toggle-code-editor-command";

export const codeEditorExtension = defineExtension({
  id: "workbench.code-editor",
  name: "Code Editor",
  version: "1.0.0",

  setup(context) {
    const panel = context.panels.register({
      id: "code-editor",
      title: defineMessage("extensions.codeEditor.title"),
      tabComponent: CodeEditorTab,
      component: CodeEditorPanel,
      defaultLocation: "right",
      defaultSize: 680,
      minSize: 420,
      maxSize: 1000,
    });
    const addMenuItem = context.slots.register("panel.right.add-menu", {
      id: "workbench.code-editor.right-panel-add-menu",
      order: 10,
      component: CodeEditorAddMenuItem,
    });
    const command = context.commands.register(toggleCodeEditorCommand);

    return [panel, addMenuItem, command];
  },
});
