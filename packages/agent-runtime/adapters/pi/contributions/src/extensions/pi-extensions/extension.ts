import { PuzzleIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { PiExtensionsSettingsItem } from "./pi-extensions-settings-item";

export const piExtensionsExtension = defineExtension({
  id: "workbench.pi-extensions",
  name: "Pi Extensions",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "pi-extensions",
      title: definePiMessage("extensions.piExtensions.title"),
      description: definePiMessage("extensions.piExtensions.description"),
      icon: PuzzleIcon,
      group: {
        id: "capabilities",
        title: defineMessage("extensions.settings.groups.capabilities"),
      },
      order: 70,
    });
    const item = context.settings.registerItem({
      sectionId: "pi-extensions",
      id: "loaded",
      title: definePiMessage("extensions.piExtensions.title"),
      description: definePiMessage("extensions.piExtensions.description"),
      keywords: [
        definePiMessage("extensions.piExtensions.registeredEvents"),
        definePiMessage("extensions.piExtensions.registeredTools"),
        definePiMessage("extensions.piExtensions.registeredCommands"),
      ],
      component: PiExtensionsSettingsItem,
    });

    return [section, item];
  },
});
