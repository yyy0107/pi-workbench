import { SlidersHorizontalIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions/authoring";

import { openSettingsCommand } from "./settings-command";
import { SettingsOverlay } from "./settings-overlay";
import { settingsOverlayStore } from "./settings-overlay-store";
import { MobileSettingsTrigger, SidebarSettingsTrigger } from "./settings-trigger";

export const settingsExtension = defineExtension({
  id: "workbench.settings",
  name: "Settings",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "general",
      title: defineMessage("extensions.settings.general.title"),
      description: defineMessage("extensions.settings.general.description"),
      icon: SlidersHorizontalIcon,
      group: {
        id: "basics",
        title: defineMessage("extensions.settings.groups.basics"),
      },
      order: 0,
    });
    const overlay = context.slots.register("shell.overlay", {
      id: "workbench.settings.overlay",
      component: SettingsOverlay,
    });
    const command = context.commands.register(openSettingsCommand);
    const sidebar = context.slots.register("sidebar.footer", {
      id: "workbench.settings.sidebar",
      order: 80,
      component: SidebarSettingsTrigger,
    });
    const mobile = context.slots.register("header.right", {
      id: "workbench.settings.mobile",
      order: 80,
      component: MobileSettingsTrigger,
    });

    return [section, overlay, command, sidebar, mobile, { dispose: settingsOverlayStore.close }];
  },
});
