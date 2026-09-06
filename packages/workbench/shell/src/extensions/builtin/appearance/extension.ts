import { Code2Icon, ImageIcon, PaletteIcon, PanelsTopLeftIcon } from "lucide-react";

import { defineMessage } from "../../../i18n";
import { defineExtension } from "@workbench/extension-sdk";

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
      title: defineMessage("extensions.appearance.theme.title"),
      description: defineMessage("extensions.appearance.theme.description"),
      keywords: [
        defineMessage("extensions.appearance.theme.mode"),
        defineMessage("extensions.appearance.palette.title"),
        defineMessage("extensions.appearance.themeSettings.accent"),
        defineMessage("extensions.appearance.themeSettings.background"),
        defineMessage("extensions.appearance.themeSettings.foreground"),
        defineMessage("extensions.appearance.themeSettings.contrast"),
      ],
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
      title: defineMessage("extensions.appearance.interface.sectionTitle"),
      description: defineMessage("extensions.appearance.interface.description"),
      keywords: [
        defineMessage("extensions.appearance.typography.title"),
        defineMessage("extensions.appearance.runningIndicator.title"),
        defineMessage("extensions.appearance.activityAnimation.title"),
        defineMessage("extensions.appearance.surfaces.title"),
        defineMessage("extensions.appearance.borders.title"),
        defineMessage("extensions.appearance.corners.title"),
      ],
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
      title: defineMessage("extensions.appearance.background.title"),
      description: defineMessage("extensions.appearance.background.description"),
      keywords: [
        defineMessage("extensions.appearance.background.colorTitle"),
        defineMessage("extensions.appearance.background.imageTitle"),
        defineMessage("extensions.appearance.background.blur"),
      ],
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
      title: defineMessage("extensions.appearance.code.title"),
      description: defineMessage("extensions.appearance.code.description"),
      keywords: [
        defineMessage("extensions.appearance.code.font"),
        defineMessage("extensions.appearance.preferences.codeFontSize"),
        defineMessage("extensions.appearance.preferences.codeTheme"),
      ],
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
