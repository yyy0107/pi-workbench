import { TerminalIcon } from "lucide-react";

import type { CommandDefinition } from "@/platform/extensions";

export const toggleTerminalCommand = {
  id: "terminal.toggle",
  title: "Toggle Terminal",
  description: "Open or close the terminal panel",
  category: "Panels",
  icon: TerminalIcon,
  shortcut: ["Ctrl", "`"],
  run(context) {
    context.panels.toggle("terminal");
  },
} satisfies CommandDefinition;
