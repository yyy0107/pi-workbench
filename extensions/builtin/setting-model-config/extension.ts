import { BotIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions/authoring";

import { ModelConfigSettingsItem } from "./model-config-settings-item";

export const settingModelConfigExtension = defineExtension({
  id: "workbench.setting-model-config",
  name: "Model Configuration Settings",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "model-config",
      title: defineMessage("extensions.modelConfig.title"),
      description: defineMessage("extensions.modelConfig.description"),
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
      title: defineMessage("extensions.modelConfig.title"),
      description: defineMessage("extensions.modelConfig.description"),
      keywords: [
        defineMessage("extensions.modelConfig.provider"),
        defineMessage("extensions.modelConfig.accountLogin"),
        defineMessage("extensions.modelConfig.apiKey"),
        defineMessage("extensions.modelConfig.apiAddress"),
        defineMessage("extensions.modelConfig.modelCatalog"),
        defineMessage("extensions.modelConfig.contextWindow"),
        defineMessage("extensions.modelConfig.maxOutputTokens"),
        defineMessage("extensions.modelConfig.reasoningLevels"),
      ],
      component: ModelConfigSettingsItem,
    });

    return [section, item];
  },
});
