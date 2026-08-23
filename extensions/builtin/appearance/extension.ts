import { Code2Icon, ImageIcon, PaletteIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { AppearanceBackground } from "./appearance-background";
import { AppearanceSettingsItem } from "./appearance-settings-item";

export const appearanceExtension = defineExtension({
  id: "workbench.appearance",
  name: "Appearance",
  version: "1.0.0",

  setup(context) {
    const group = {
      id: "basics",
      title: defineMessage("extensions.settings.groups.basics"),
    };
    const appearanceSection = context.settings.registerSection({
      id: "appearance",
      title: defineMessage("extensions.appearance.title"),
      description: defineMessage("extensions.appearance.description"),
      icon: PaletteIcon,
      group,
      order: 10,
    });
    const appearanceSettings = context.settings.registerItem({
      sectionId: "appearance",
      id: "global-style",
      component: AppearanceSettingsItem,
    });
    const backgroundSection = context.settings.registerSection({
      id: "background",
      title: defineMessage("extensions.appearance.background.sectionTitle"),
      description: defineMessage("extensions.appearance.background.description"),
      icon: ImageIcon,
      group,
      order: 20,
    });
    const backgroundSettings = context.settings.registerItem({
      sectionId: "background",
      id: "background-style",
      component: AppearanceSettingsItem,
    });
    const codeSection = context.settings.registerSection({
      id: "code",
      title: defineMessage("extensions.appearance.code.sectionTitle"),
      description: defineMessage("extensions.appearance.code.description"),
      icon: Code2Icon,
      group,
      order: 30,
    });
    const codeSettings = context.settings.registerItem({
      sectionId: "code",
      id: "code-style",
      component: AppearanceSettingsItem,
    });
    const background = context.slots.register("shell.background", {
      id: "workbench.appearance.background",
      component: AppearanceBackground,
    });

    return [
      appearanceSection,
      appearanceSettings,
      backgroundSection,
      backgroundSettings,
      codeSection,
      codeSettings,
      background,
    ];
  },
});
