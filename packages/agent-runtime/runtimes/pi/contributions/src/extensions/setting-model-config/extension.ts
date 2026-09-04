import { BotIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { ModelConfigSettingsItem } from "./model-config-settings-item";

export const settingModelConfigExtension = defineExtension({
  id: "workbench.setting-model-config",
  name: "Model Configuration Settings",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "model-config",
      title: definePiMessage("extensions.modelConfig.title"),
      description: definePiMessage("extensions.modelConfig.description"),
      icon: BotIcon,
      group: {
        id: "intelligence",
        title: defineMessage("extensions.settings.groups.intelligence"),
      },
      order: 40,
    });
    const item = context.settings.registerItem({
      sectionId: "model-config",
      id: "providers",
      title: definePiMessage("extensions.modelConfig.title"),
      description: definePiMessage("extensions.modelConfig.description"),
      keywords: [
        definePiMessage("extensions.modelConfig.provider"),
        definePiMessage("extensions.modelConfig.accountLogin"),
        definePiMessage("extensions.modelConfig.apiKey"),
        definePiMessage("extensions.modelConfig.apiAddress"),
        definePiMessage("extensions.modelConfig.modelCatalog"),
        definePiMessage("extensions.modelConfig.contextWindow"),
        definePiMessage("extensions.modelConfig.maxOutputTokens"),
        definePiMessage("extensions.modelConfig.reasoningLevels"),
      ],
      component: ModelConfigSettingsItem,
    });

    return [section, item];
  },
});
