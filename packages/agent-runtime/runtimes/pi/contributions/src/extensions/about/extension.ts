import { InfoIcon } from "lucide-react";
import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";
import { AboutSettingsItem } from "./about-settings-item";

export const aboutExtension = defineExtension({
  id: "workbench.about",
  name: "About",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "about",
      title: definePiMessage("extensions.about.title"),
      group: { id: "other", title: defineMessage("extensions.settings.groups.other") },
      icon: InfoIcon,
      order: 100,
    });
    const item = context.settings.registerItem({
      sectionId: "about",
      id: "application",
      title: definePiMessage("extensions.about.title"),
      keywords: [
        definePiMessage("extensions.about.version"),
        definePiMessage("extensions.about.license"),
        definePiMessage("extensions.about.source"),
        definePiMessage("extensions.about.contribute"),
      ],
      component: AboutSettingsItem,
    });

    return [section, item];
  },
});
