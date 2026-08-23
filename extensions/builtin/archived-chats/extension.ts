import { ArchiveIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { ArchivedChatsSettingsItem } from "./archived-chats-settings-item";

export const archivedChatsExtension = defineExtension({
  id: "workbench.archived-chats",
  name: "Archived Chats",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "archived-chats",
      title: defineMessage("extensions.archivedChats.title"),
      description: defineMessage("extensions.archivedChats.description"),
      icon: ArchiveIcon,
      group: {
        id: "data",
        title: defineMessage("extensions.settings.groups.data"),
      },
      order: 80,
    });
    const item = context.settings.registerItem({
      sectionId: "archived-chats",
      id: "chat-list",
      component: ArchivedChatsSettingsItem,
    });

    return [section, item];
  },
});
