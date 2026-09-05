import { GaugeIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { ContextManagementSettingsItem, SystemPromptMainView } from "./agent-settings-items";

export const agentConfigurationExtension = defineExtension({
  id: "workbench.agent-configuration",
  name: "Agent Configuration",
  version: "1.0.0",

  setup(context) {
    const systemPrompt = context.mainViews.register({
      kind: "system-prompts",
      component: SystemPromptMainView,
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
