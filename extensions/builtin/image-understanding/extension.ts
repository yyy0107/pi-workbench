import { ScanTextIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions";

import { ImageUnderstandingSettingsItem } from "./image-understanding-settings-item";
import { ImageRecognitionRenderer } from "./image-recognition-renderer";
import { IMAGE_RECOGNITION_DATA_PART_NAME } from "./image-recognition-presentation";

export const imageUnderstandingExtension = defineExtension({
  id: "workbench.image-understanding",
  name: "Image Understanding",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "image-understanding",
      title: defineMessage("extensions.imageUnderstanding.title"),
      description: defineMessage("extensions.imageUnderstanding.description"),
      icon: ScanTextIcon,
      group: {
        id: "intelligence",
        title: defineMessage("extensions.settings.groups.intelligence"),
      },
      order: 45,
    });
    const item = context.settings.registerItem({
      sectionId: "image-understanding",
      id: "providers",
      component: ImageUnderstandingSettingsItem,
    });
    const renderer = context.renderers.data.register(
      IMAGE_RECOGNITION_DATA_PART_NAME,
      ImageRecognitionRenderer,
    );

    return [section, item, renderer];
  },
});
