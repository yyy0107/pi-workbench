import { SparklesIcon } from "lucide-react";

import { defineExtension } from "@/platform/extensions";

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
      title: "Skills",
      icon: SparklesIcon,
      component: SkillsPanel,
      defaultLocation: "right",
      defaultSize: 360,
      minSize: 280,
      maxSize: 640,
    });

    return [slot, panel];
  },
});
