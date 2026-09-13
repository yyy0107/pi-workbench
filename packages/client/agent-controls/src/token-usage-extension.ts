import { defineExtension } from "@workbench/extension-sdk";

import { TokenUsage } from "./token-usage";

export const tokenUsageExtension = defineExtension({
  id: "workbench.token-usage",
  name: "Token Usage",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("statusbar.right", {
      id: "workbench.token-usage.statusbar",
      order: 10,
      component: TokenUsage,
    });
  },
});
