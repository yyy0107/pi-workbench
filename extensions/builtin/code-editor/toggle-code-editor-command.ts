import { FileCode2Icon } from "lucide-react";

import { defineMessage } from "@/i18n";
import type { CommandDefinition } from "@/platform/extensions";

export const toggleCodeEditorCommand = {
  id: "code-editor.toggle",
  title: defineMessage("extensions.codeEditor.toggleTitle"),
  description: defineMessage("extensions.codeEditor.toggleDescription"),
  category: defineMessage("extensions.shared.panelsCategory"),
  icon: FileCode2Icon,
  run(context) {
    context.panels.toggle("code-editor");
  },
} satisfies CommandDefinition;
