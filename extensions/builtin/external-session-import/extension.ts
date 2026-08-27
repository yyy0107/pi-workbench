import { ImportIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions/authoring";

import { ExternalSessionImportSettingsItem } from "./external-session-import-settings-item";

export const externalSessionImportExtension = defineExtension({
  id: "workbench.external-session-import",
  name: "External Session Import",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "external-session-import",
      title: defineMessage("extensions.externalSessionImport.title"),
      description: defineMessage("extensions.externalSessionImport.description"),
      icon: ImportIcon,
      group: {
        id: "data",
        title: defineMessage("extensions.settings.groups.data"),
      },
      order: 70,
    });
    const item = context.settings.registerItem({
      sectionId: "external-session-import",
      id: "sources",
      title: defineMessage("extensions.externalSessionImport.title"),
      description: defineMessage("extensions.externalSessionImport.description"),
      keywords: [
        defineMessage("extensions.externalSessionImport.sources.codex"),
        defineMessage("extensions.externalSessionImport.sources.claude-code"),
        defineMessage("extensions.externalSessionImport.sources.cursor"),
      ],
      component: ExternalSessionImportSettingsItem,
    });

    return [section, item];
  },
});
