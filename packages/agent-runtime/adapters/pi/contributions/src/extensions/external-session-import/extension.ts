import { ImportIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { ExternalSessionImportSettingsItem } from "./external-session-import-settings-item";

export const externalSessionImportExtension = defineExtension({
  id: "workbench.external-session-import",
  name: "External Session Import",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "external-session-import",
      title: definePiMessage("extensions.externalSessionImport.title"),
      description: definePiMessage("extensions.externalSessionImport.description"),
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
      title: definePiMessage("extensions.externalSessionImport.title"),
      description: definePiMessage("extensions.externalSessionImport.description"),
      keywords: [
        definePiMessage("extensions.externalSessionImport.sources.codex"),
        definePiMessage("extensions.externalSessionImport.sources.claude-code"),
        definePiMessage("extensions.externalSessionImport.sources.cursor"),
      ],
      component: ExternalSessionImportSettingsItem,
    });

    return [section, item];
  },
});
