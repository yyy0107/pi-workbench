import { PuzzleIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { PiExtensionsSettingsItem } from "./pi-extensions-settings-item";

export const piExtensionsExtension = defineExtension({
  id: "workbench.pi-extensions",
  name: "Pi Extensions",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "pi-extensions",
      title: defineMessage("extensions.piExtensions.title"),
      description: defineMessage("extensions.piExtensions.description"),
      icon: PuzzleIcon,
      order: 8,
    });
    const item = context.settings.registerItem({
      sectionId: "pi-extensions",
      id: "loaded",
      component: PiExtensionsSettingsItem,
    });

    return [section, item];
  },
});
