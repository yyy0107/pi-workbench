import { TerminalIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { toggleTerminalCommand } from "./open-terminal-command";
import { BashToolRenderer } from "./bash-tool-renderer";
import { TerminalPanel } from "./terminal-panel";
import { TerminalTrigger } from "./terminal-trigger";
import { TerminalWorkspaceAction } from "./terminal-workspace-action";
import { TerminalWorkspaceEmptyAction } from "./terminal-workspace-empty-action";

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
    const workspaceAction = context.slots.register("workspace.actions", {
      id: "workbench.terminal.workspace-action",
      order: 30,
      component: TerminalWorkspaceAction,
    });
    const workspaceEmptyAction = context.slots.register("workspace.empty.actions", {
      id: "workbench.terminal.workspace-empty-action",
      order: 30,
      component: TerminalWorkspaceEmptyAction,
    });
    const mobileTrigger = context.slots.register("header.right", {
      id: "workbench.terminal.mobile-trigger",
      order: 100,
      component: TerminalTrigger,
    });

    return [panel, command, bashRenderer, workspaceAction, workspaceEmptyAction, mobileTrigger];
  },
});
