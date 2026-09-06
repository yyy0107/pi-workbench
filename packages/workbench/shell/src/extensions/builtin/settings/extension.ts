import { defineExtension } from "@workbench/extension-sdk";
import { MessagesSquareIcon, SettingsIcon } from "lucide-react";
import { defineMessage } from "../../../i18n";

import { ConversationSettingsItem } from "./conversation-settings-item";
import { OnboardingSettingsItem } from "./onboarding-settings-item";

import { openSettingsCommand } from "./settings-command";
import { SETTINGS_MAIN_VIEW_KIND } from "./settings-main-view";
import { SettingsMainViewContent } from "./settings-main-view-content";
import { SettingsSidebarRail } from "./settings-sidebar-rail";
import { SettingsSidebar } from "./settings-sidebar";
import { SidebarSettingsTrigger } from "./settings-trigger";

export const settingsExtension = defineExtension({
  id: "workbench.settings",
  name: "Settings",
  version: "1.0.0",

  setup(context) {
    const general = context.settings.registerSection({
      id: "general",
      title: defineMessage("extensions.settings.general.title"),
      description: defineMessage("extensions.settings.general.description"),
      icon: SettingsIcon,
      group: { id: "basics", title: defineMessage("extensions.settings.groups.basics") },
      order: -10,
    });
    const onboarding = context.settings.registerItem({
      sectionId: "general",
      id: "onboarding",
      title: defineMessage("extensions.settings.onboarding.title"),
      order: 100,
      component: OnboardingSettingsItem,
    });
    const section = context.settings.registerSection({
      id: "conversation",
      title: defineMessage("extensions.settings.conversation.title"),
      description: defineMessage("extensions.settings.conversation.description"),
      icon: MessagesSquareIcon,
      group: { id: "basics", title: defineMessage("extensions.settings.groups.basics") },
      order: 0,
    });
    const preferences = context.settings.registerItem({
      sectionId: "conversation",
      id: "preferences",
      title: defineMessage("extensions.settings.conversation.title"),
      keywords: [
        defineMessage("extensions.settings.conversation.runningMessageMode"),
        defineMessage("extensions.settings.conversation.showReasoning"),
        defineMessage("extensions.settings.conversation.groupParallelTools"),
      ],
      component: ConversationSettingsItem,
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
    return [general, onboarding, section, preferences, mainView, command, sidebar];
  },
});
