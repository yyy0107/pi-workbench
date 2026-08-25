import { Code2Icon, ImageIcon, PaletteIcon, PanelsTopLeftIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions/authoring";

import { AppearanceBackground } from "./appearance-background";
import { AppearanceResetAction } from "./appearance-reset-action";
import { AppearanceSettingsItem } from "./appearance-settings-item";

export const appearanceExtension = defineExtension({
  id: "workbench.appearance",
  name: "Appearance",
  version: "1.0.0",

  setup(context) {
    const group = {
      id: "appearance",
      title: defineMessage("extensions.settings.groups.appearance"),
    };
    const appearanceSection = context.settings.registerSection({
      id: "appearance",
      title: defineMessage("extensions.appearance.title"),
      description: defineMessage("extensions.appearance.description"),
      headerAction: AppearanceResetAction,
      icon: PaletteIcon,
      group,
      order: 10,
    });
    const appearanceSettings = context.settings.registerItem({
      sectionId: "appearance",
      id: "global-style",
      component: AppearanceSettingsItem,
    });
    const interfaceSection = context.settings.registerSection({
      id: "interface",
      title: defineMessage("extensions.appearance.interface.sectionTitle"),
      description: defineMessage("extensions.appearance.interface.description"),
      headerAction: AppearanceResetAction,
      icon: PanelsTopLeftIcon,
      group,
      order: 20,
    });
    const interfaceSettings = context.settings.registerItem({
      sectionId: "interface",
      id: "interface-style",
      component: AppearanceSettingsItem,
    });
    const backgroundSection = context.settings.registerSection({
      id: "background",
      title: defineMessage("extensions.appearance.background.sectionTitle"),
      description: defineMessage("extensions.appearance.background.description"),
      headerAction: AppearanceResetAction,
      icon: ImageIcon,
      group,
      order: 30,
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
      headerAction: AppearanceResetAction,
      icon: Code2Icon,
      group,
      order: 40,
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
      interfaceSection,
      interfaceSettings,
      backgroundSection,
      backgroundSettings,
      codeSection,
      codeSettings,
      background,
    ];
  },
});
