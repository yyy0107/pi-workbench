import { defineExtension } from "@/platform/extensions/authoring";

import { WorkbenchBrand } from "./workbench-brand";

export const workbenchBrandExtension = defineExtension({
  id: "workbench.brand",
  name: "Workbench Brand",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("sidebar.brand", {
      id: "workbench.brand.sidebar",
      order: 0,
      component: WorkbenchBrand,
    });
  },
});
