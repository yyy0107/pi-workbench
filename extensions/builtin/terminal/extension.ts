import { TerminalIcon } from "lucide-react";

import { defineExtension } from "@/platform/extensions";

import { toggleTerminalCommand } from "./open-terminal-command";
import { TerminalPanel } from "./terminal-panel";
import { TerminalTrigger } from "./terminal-trigger";

export const terminalExtension = defineExtension({
  id: "workbench.terminal",
  name: "Terminal",
  version: "1.0.0",

  setup(context) {
    const panel = context.panels.register({
      id: "terminal",
      title: "Terminal",
      icon: TerminalIcon,
      component: TerminalPanel,
      defaultLocation: "bottom",
      defaultSize: 280,
      minSize: 160,
      maxSize: 560,
    });

    const command = context.commands.register(toggleTerminalCommand);
    const mobileTrigger = context.slots.register("header.right", {
      id: "workbench.terminal.mobile-trigger",
      order: 100,
      component: TerminalTrigger,
    });

    return [panel, command, mobileTrigger];
  },
});
