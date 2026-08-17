import { TerminalIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import type { CommandDefinition } from "@/platform/extensions";

export const toggleTerminalCommand = {
  id: "terminal.toggle",
  title: defineMessage("extensions.terminal.toggleTitle"),
  description: defineMessage("extensions.terminal.toggleDescription"),
  category: defineMessage("extensions.shared.panelsCategory"),
  icon: TerminalIcon,
  shortcut: ["Ctrl", "`"],
  run(context) {
    context.panels.toggle("terminal");
  },
} satisfies CommandDefinition;
