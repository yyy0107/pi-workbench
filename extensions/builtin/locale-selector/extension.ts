import { defineExtension } from "@/platform/extensions";

import { LocaleSettingsItem, MobileLocaleSelector, SidebarLocaleSelector } from "./locale-selector";

export const localeSelectorExtension = defineExtension({
  id: "workbench.locale-selector",
  name: "Locale Selector",
  version: "1.0.0",

  setup(context) {
    const sidebar = context.slots.register("sidebar.footer", {
      id: "workbench.locale-selector.sidebar",
      order: 100,
      component: SidebarLocaleSelector,
    });
    const mobile = context.slots.register("header.right", {
      id: "workbench.locale-selector.mobile",
      order: 90,
      component: MobileLocaleSelector,
    });
    const settingsItem = context.settings.registerItem({
      sectionId: "general",
      id: "language",
      order: 10,
      component: LocaleSettingsItem,
    });

    return [sidebar, mobile, settingsItem];
  },
});
