import { defineExtension } from "@/platform/extensions/authoring";

import { WorkbenchBrand } from "./workbench-brand";
import { WorkbenchBrandToggle } from "./workbench-brand-toggle";

export const workbenchBrandExtension = defineExtension({
  id: "workbench.brand",
  name: "Workbench Brand",
  version: "1.0.0",

  setup(context) {
    const brand = context.slots.register("sidebar.brand", {
      id: "workbench.brand.sidebar",
      order: 0,
      component: WorkbenchBrand,
    });
    const toggle = context.slots.register("shell.overlay", {
      id: "workbench.brand.sidebar-toggle",
      order: 0,
      component: WorkbenchBrandToggle,
    });

    return [brand, toggle];
  },
});
