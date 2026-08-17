import { TerminalIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { toggleTerminalCommand } from "./open-terminal-command";
import { BashToolRenderer } from "./bash-tool-renderer";
import { TerminalAddMenuItem } from "./terminal-add-menu-item";
import { TerminalPanel } from "./terminal-panel";
import { TerminalTrigger } from "./terminal-trigger";

export const terminalExtension = defineExtension({
  id: "workbench.terminal",
  name: "Terminal",
  version: "1.0.0",

  setup(context) {
    const panel = context.panels.register({
      id: "terminal",
      title: defineMessage("extensions.terminal.title"),
      icon: TerminalIcon,
      component: TerminalPanel,
      defaultLocation: "bottom",
      defaultSize: 280,
      minSize: 160,
      maxSize: 560,
    });

    const command = context.commands.register(toggleTerminalCommand);
    const bashRenderer = context.renderers.tools.register("bash", BashToolRenderer);
    const addMenuItem = context.slots.register("panel.right.add-menu", {
      id: "workbench.terminal.right-panel-add-menu",
      order: 30,
      component: TerminalAddMenuItem,
    });
    const mobileTrigger = context.slots.register("header.right", {
      id: "workbench.terminal.mobile-trigger",
      order: 100,
      component: TerminalTrigger,
    });

    return [panel, command, bashRenderer, addMenuItem, mobileTrigger];
  },
});
