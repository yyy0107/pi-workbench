import { ChartNoAxesCombinedIcon } from "lucide-react";
import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";
import { definePiMessage } from "../../i18n";
import { UsageStatisticsSettingsItem } from "./usage-statistics-settings-item";

export const usageStatisticsExtension = defineExtension({
  id: "workbench.usage-statistics",
  name: "Usage Statistics",
  version: "1.0.0",
  setup(context) {
    return [
      context.settings.registerSection({
        id: "usage-statistics",
        title: definePiMessage("extensions.usageStatistics.title"),
        description: definePiMessage("extensions.usageStatistics.description"),
        icon: ChartNoAxesCombinedIcon,
        group: { id: "data", title: defineMessage("extensions.settings.groups.data") },
        order: 65,
      }),
      context.settings.registerItem({
        sectionId: "usage-statistics",
        id: "overview",
        title: definePiMessage("extensions.usageStatistics.title"),
        keywords: [
          definePiMessage("extensions.usageStatistics.activity"),
          definePiMessage("extensions.usageStatistics.trend"),
        ],
        component: UsageStatisticsSettingsItem,
      }),
    ];
  },
});
