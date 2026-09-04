import { GaugeIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { ContextManagementSettingsItem, SystemPromptSettingsItem } from "./agent-settings-items";

export const agentConfigurationExtension = defineExtension({
  id: "workbench.agent-configuration",
  name: "Agent Configuration",
  version: "1.0.0",

  setup(context) {
    const systemPrompt = context.settings.registerItem({
      sectionId: "general",
      id: "system-prompt",
      title: definePiMessage("extensions.agentConfiguration.systemPrompt.title"),
      description: definePiMessage("extensions.agentConfiguration.systemPrompt.description"),
      keywords: [
        definePiMessage("extensions.agentConfiguration.systemPrompt.editorLabel"),
        definePiMessage("extensions.agentConfiguration.systemPrompt.useDefault"),
      ],
      component: SystemPromptSettingsItem,
      order: 20,
    });
    const contextSection = context.settings.registerSection({
      id: "context-management",
      title: definePiMessage("extensions.agentConfiguration.context.title"),
      description: definePiMessage("extensions.agentConfiguration.context.description"),
      icon: GaugeIcon,
      group: {
        id: "intelligence",
        title: defineMessage("extensions.settings.groups.intelligence"),
      },
      order: 50,
    });
    const contextSettings = context.settings.registerItem({
      sectionId: "context-management",
      id: "compaction",
      title: definePiMessage("extensions.agentConfiguration.context.compactionTitle"),
      description: definePiMessage("extensions.agentConfiguration.context.compactionDescription"),
      keywords: [
        definePiMessage("extensions.agentConfiguration.context.modelWindowTitle"),
        definePiMessage("extensions.agentConfiguration.context.autoCompaction"),
        definePiMessage("extensions.agentConfiguration.context.reserveTokens"),
        definePiMessage("extensions.agentConfiguration.context.keepRecentTokens"),
      ],
      component: ContextManagementSettingsItem,
    });

    return [systemPrompt, contextSection, contextSettings];
  },
});
