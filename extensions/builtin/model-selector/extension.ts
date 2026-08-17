import { defineExtension } from "@/platform/extensions";

import { ModelSelector } from "./model-selector";

export const modelSelectorExtension = defineExtension({
  id: "workbench.model-selector",
  name: "Model Selector",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("composer.actions.right", {
      id: "workbench.model-selector.composer",
      order: 10,
      component: ModelSelector,
    });
  },
});
