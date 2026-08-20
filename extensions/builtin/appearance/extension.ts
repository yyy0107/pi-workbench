import { PaletteIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { AppearanceBackground } from "./appearance-background";
import { AppearanceSettingsItem } from "./appearance-settings-item";

export const appearanceExtension = defineExtension({
  id: "workbench.appearance",
  name: "Appearance",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "appearance",
      title: defineMessage("extensions.appearance.title"),
      description: defineMessage("extensions.appearance.description"),
      icon: PaletteIcon,
      order: 10,
    });
    const settingsItem = context.settings.registerItem({
      sectionId: "appearance",
      id: "global-style",
      component: AppearanceSettingsItem,
    });
    const background = context.slots.register("shell.background", {
      id: "workbench.appearance.background",
      component: AppearanceBackground,
    });

    return [section, settingsItem, background];
  },
});
