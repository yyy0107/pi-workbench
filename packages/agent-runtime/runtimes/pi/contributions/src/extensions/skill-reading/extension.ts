import { FileSearchIcon, WrenchIcon } from "lucide-react";
import { defineExtension, type ToolPresentationDefinition } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";
import { skillReadingForCall } from "./skill-reading-state";

export const skillReadingPresentation: ToolPresentationDefinition = {
  label: defineMessage("extensions.messagePresentation.toolTimeline.steps.read"),
  activeLabel: defineMessage("extensions.messagePresentation.toolTimeline.activeSteps.read"),
  icon: FileSearchIcon,
  resolve(block, node) {
    const skill = skillReadingForCall(block, node);
    if (!skill) return undefined;
    const label = definePiMessage(
      `extensions.skillReading.${skill.isDocument ? "document" : "resource"}.${skill.status}`,
      { name: skill.name },
    );
    return {
      label,
      activeLabel: label,
      terminalLabel: label,
      icon: WrenchIcon,
      compact: true,
      summarize: () => (skill.isDocument ? "" : skill.path),
    };
  },
};

export const skillReadingExtension = defineExtension({
  id: "workbench.skill-reading",
  name: "Skill Reading",
  version: "1.0.0",
  setup(context) {
    return context.renderers.toolPresentations.register("read", skillReadingPresentation);
  },
});
