import { defineSettingsUiMessage } from "@workbench/ui-settings/i18n";
import type {
  ExtensionContext,
  Disposable,
  SettingsSectionGroupDefinition,
} from "@workbench/extension-sdk";
import { defineExtension } from "@workbench/extension-sdk";
import { SettingsIcon } from "lucide-react";
import { defineSettingsUiMessage as defineMessage } from "./i18n";

import { openSettingsCommand } from "./settings-command";
import { SETTINGS_MAIN_VIEW_KIND } from "@workbench/ui-settings/request";
import { SettingsMainViewContent } from "./settings-main-view-content";
import { SettingsSidebarRail } from "./settings-sidebar-rail";
import { SettingsSidebar } from "./settings-sidebar";
import { SidebarSettingsTrigger } from "./settings-trigger";

export function createSettingsExtension(
  registerGeneralSettings: (
    context: ExtensionContext,
    group: SettingsSectionGroupDefinition,
  ) => readonly Disposable[],
) {
  return defineExtension({
    id: "workbench.settings",
    name: "Settings",
    version: "1.0.0",

    setup(context) {
      const general = context.settings.registerSection({
        id: "general",
        title: defineMessage("extensions.settings.general.title"),
        description: defineMessage("extensions.settings.general.description"),
        icon: SettingsIcon,
        group: {
          id: "basics",
          title: defineSettingsUiMessage("extensions.settings.groups.basics"),
        },
        order: -10,
      });
      const contributions = registerGeneralSettings(context, {
        id: "basics",
        title: defineSettingsUiMessage("extensions.settings.groups.basics"),
      });
      const mainView = context.mainViews.register({
        kind: SETTINGS_MAIN_VIEW_KIND,
        component: SettingsMainViewContent,
        sidebar: SettingsSidebar,
        sidebarRail: SettingsSidebarRail,
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
      return [general, ...contributions, mainView, command, sidebar];
    },
  });
}
