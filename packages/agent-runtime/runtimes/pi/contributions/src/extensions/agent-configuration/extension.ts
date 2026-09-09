import { GaugeIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { PI_CACHE_MISS_DATA_NAME } from "@workbench/agent-runtime-pi-protocol/messages";
import { CacheMissAction, CacheMissBody } from "./cache-miss-notice";

import {
  CacheMissSettingsItem,
  ContextManagementSettingsItem,
  SystemPromptMainView,
} from "./agent-settings-items";

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

    const cacheMissSettings = context.settings.registerItem({
      sectionId: "context-management",
      id: "cache-miss-notices",
      title: definePiMessage("extensions.agentConfiguration.cacheMiss.title"),
      description: definePiMessage("extensions.agentConfiguration.cacheMiss.description"),
      component: CacheMissSettingsItem,
      order: 10,
    });
    const cacheMissRenderer = context.renderers.data.register(
      PI_CACHE_MISS_DATA_NAME,
      CacheMissBody,
    );
    const cacheMissAction = context.slots.register("message.actions", {
      id: "workbench.agent-configuration.cache-miss",
      order: 20,
      component: CacheMissAction,
    });
    return [
      systemPrompt,
      contextSection,
      contextSettings,
      cacheMissSettings,
      cacheMissRenderer,
      cacheMissAction,
    ];
  },
});
