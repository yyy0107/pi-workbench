import { SlidersHorizontalIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions/authoring";

import { openSettingsCommand } from "./settings-command";
import { SettingsHeaderAction } from "./settings-header-action";
import { SETTINGS_MAIN_VIEW_KIND } from "./settings-main-view";
import { SettingsMainViewContent } from "./settings-main-view-content";
import { SettingsSidebar } from "./settings-sidebar";
import { SidebarSettingsTrigger } from "./settings-trigger";

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
    const mainView = context.mainViews.register({
      kind: SETTINGS_MAIN_VIEW_KIND,
      component: SettingsMainViewContent,
      sidebar: SettingsSidebar,
      chrome: {
        productIcon: "hidden",
        headerLeft: "hidden",
        rightWorkspace: "hidden",
      },
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
      component: SettingsHeaderAction,
    });

    return [section, mainView, command, sidebar, mobile];
  },
});
