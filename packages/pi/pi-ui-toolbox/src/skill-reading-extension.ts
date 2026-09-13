import { FileSearchIcon, SearchIcon, WrenchIcon } from "lucide-react";
import { defineExtension, type ToolPresentationDefinition } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/ui-tool/i18n";

import { definePiMessage } from "./i18n";
import { skillReadingForCall } from "../lib/skill-reading-state";
import { FileMutationToolRenderer } from "./file-mutation-tool-renderer";
import { editToolPresentation, writeToolPresentation } from "./file-mutation-tool-presentation";

function argumentString(
  block: Parameters<NonNullable<ToolPresentationDefinition["summarize"]>>[0],
  ...keys: string[]
) {
  const args = block.arguments as Record<string, unknown> | undefined;
  for (const key of keys) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export const skillReadingPresentation: ToolPresentationDefinition = {
  label: defineMessage("extensions.messagePresentation.toolTimeline.steps.read"),
  activeLabel: defineMessage("extensions.messagePresentation.toolTimeline.activeSteps.read"),
  icon: FileSearchIcon,
  summarize: (block) => {
    const path = argumentString(block, "path", "file", "filePath", "file_path");
    return path?.split(/[\\/]/).filter(Boolean).at(-1) ?? path ?? block.toolName;
  },
  group: "exploration",
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
      group: "exploration",
    };
  },
};

const searchPresentation: ToolPresentationDefinition = {
  label: defineMessage("extensions.messagePresentation.toolTimeline.steps.searched"),
  activeLabel: defineMessage("extensions.messagePresentation.toolTimeline.activeSteps.searched"),
  icon: SearchIcon,
  summarize: (block) => argumentString(block, "query", "pattern", "path", "file") ?? block.toolName,
  group: "exploration",
};

export const skillReadingExtension = defineExtension({
  id: "workbench.skill-reading",
  name: "Skill Reading",
  version: "1.0.0",
  setup(context) {
    return [
      context.renderers.toolPresentations.register("read", skillReadingPresentation),
      context.renderers.toolPresentations.register("edit", editToolPresentation),
      context.renderers.toolPresentations.register("write", writeToolPresentation),
      context.renderers.tools.register("edit", FileMutationToolRenderer),
      context.renderers.tools.register("write", FileMutationToolRenderer),
      context.renderers.toolPresentations.register("grep", searchPresentation),
      context.renderers.toolPresentations.register("find", searchPresentation),
      context.renderers.toolPresentations.register("ls", {
        ...searchPresentation,
        label: defineMessage("extensions.messagePresentation.toolTimeline.steps.read"),
        activeLabel: defineMessage("extensions.messagePresentation.toolTimeline.activeSteps.read"),
        icon: FileSearchIcon,
      }),
    ];
  },
});
