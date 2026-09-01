import { SparklesIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { SkillsSettingsItem } from "./skills-settings-item";

export const skillsExtension = defineExtension({
  id: "workbench.skills",
  name: "Skills",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "skills",
      title: definePiMessage("extensions.skills.title"),
      description: definePiMessage("extensions.skills.description"),
      icon: SparklesIcon,
      group: {
        id: "capabilities",
        title: defineMessage("extensions.settings.groups.capabilities"),
      },
      order: 60,
    });
    const item = context.settings.registerItem({
      sectionId: "skills",
      id: "catalog",
      title: definePiMessage("extensions.skills.title"),
      description: definePiMessage("extensions.skills.description"),
      component: SkillsSettingsItem,
    });

    return [section, item];
  },
});
