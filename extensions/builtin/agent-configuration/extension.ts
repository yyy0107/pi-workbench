import { GaugeIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { ContextManagementSettingsItem, SystemPromptSettingsItem } from "./agent-settings-items";

export const agentConfigurationExtension = defineExtension({
  id: "workbench.agent-configuration",
  name: "Agent Configuration",
  version: "1.0.0",

  setup(context) {
    const systemPrompt = context.settings.registerItem({
      sectionId: "general",
      id: "system-prompt",
      component: SystemPromptSettingsItem,
      order: 20,
    });
    const contextSection = context.settings.registerSection({
      id: "context-management",
      title: defineMessage("extensions.agentConfiguration.context.title"),
      description: defineMessage("extensions.agentConfiguration.context.description"),
      icon: GaugeIcon,
      order: 6,
    });
    const contextSettings = context.settings.registerItem({
      sectionId: "context-management",
      id: "compaction",
      component: ContextManagementSettingsItem,
    });

    return [systemPrompt, contextSection, contextSettings];
  },
});
