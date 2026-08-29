import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions/authoring";

import { HardwareAccelerationSettingsItem } from "./hardware-acceleration-settings-item";

export const hardwareAccelerationExtension = defineExtension({
  id: "workbench.hardware-acceleration",
  name: "Hardware Acceleration",
  version: "1.0.0",

  setup(context) {
    return context.settings.registerItem({
      sectionId: "general",
      id: "hardware-acceleration",
      title: defineMessage("extensions.hardwareAcceleration.enable"),
      description: defineMessage("extensions.hardwareAcceleration.description"),
      order: 20,
      component: HardwareAccelerationSettingsItem,
    });
  },
});
