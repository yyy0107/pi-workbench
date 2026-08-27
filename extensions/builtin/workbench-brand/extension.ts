import { defineExtension } from "@/platform/extensions/authoring";

import { WorkbenchBrandToggle } from "./workbench-brand-toggle";

export const workbenchBrandExtension = defineExtension({
  id: "workbench.brand",
  name: "Workbench Brand",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("shell.overlay", {
      id: "workbench.brand.sidebar-toggle",
      order: 0,
      component: WorkbenchBrandToggle,
    });
  },
});
