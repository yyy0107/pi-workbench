import { SparklesIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { SkillsAddMenuItem } from "./skills-add-menu-item";
import { SkillsPanel } from "./skills-panel";
import { SkillsTrigger } from "./skills-trigger";

export const skillsExtension = defineExtension({
  id: "workbench.skills",
  name: "Skills",
  version: "1.0.0",

  setup(context) {
    const slot = context.slots.register("composer.actions.left", {
      id: "workbench.skills.composer",
      order: 30,
      component: SkillsTrigger,
    });

    const panel = context.panels.register({
      id: "skills",
      title: defineMessage("extensions.skills.title"),
      icon: SparklesIcon,
      component: SkillsPanel,
      defaultLocation: "right",
      defaultSize: 360,
      minSize: 280,
      maxSize: 640,
    });
    const addMenuItem = context.slots.register("panel.right.add-menu", {
      id: "workbench.skills.right-panel-add-menu",
      order: 20,
      component: SkillsAddMenuItem,
    });

    return [slot, panel, addMenuItem];
  },
});
