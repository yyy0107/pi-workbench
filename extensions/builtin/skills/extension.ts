import { SparklesIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { SkillsSettingsItem } from "./skills-settings-item";

export const skillsExtension = defineExtension({
  id: "workbench.skills",
  name: "Skills",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "skills",
      title: defineMessage("extensions.skills.title"),
      description: defineMessage("extensions.skills.description"),
      icon: SparklesIcon,
      order: 7,
    });
    const item = context.settings.registerItem({
      sectionId: "skills",
      id: "catalog",
      component: SkillsSettingsItem,
    });

    return [section, item];
  },
});
