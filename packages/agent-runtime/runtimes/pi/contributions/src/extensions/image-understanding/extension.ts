import { ScanTextIcon } from "lucide-react";

import { defineExtension, type DataPresentationDefinition } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { AttachmentUnderstandingSettingsItem } from "./image-understanding-settings-item";
import { AttachmentRecognitionRenderer } from "./image-recognition-renderer";
import {
  ATTACHMENT_RECOGNITION_DATA_PART_NAME,
  LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME,
  parseAttachmentRecognitionPresentation,
} from "./image-recognition-presentation";

export const attachmentUnderstandingExtension = defineExtension({
  id: "workbench.image-understanding",
  name: "Attachment Understanding",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "image-understanding",
      title: definePiMessage("extensions.imageUnderstanding.title"),
      description: definePiMessage("extensions.imageUnderstanding.description"),
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
      title: definePiMessage("extensions.imageUnderstanding.title"),
      description: definePiMessage("extensions.imageUnderstanding.description"),
      keywords: [
        definePiMessage("extensions.imageUnderstanding.settings.routing.label"),
        definePiMessage("extensions.imageUnderstanding.settings.engine.label"),
        definePiMessage("extensions.imageUnderstanding.settings.ocrProvider.label"),
        definePiMessage("extensions.imageUnderstanding.settings.ocrAdapter.label"),
      ],
      component: AttachmentUnderstandingSettingsItem,
    });
    const renderer = context.renderers.data.register(
      ATTACHMENT_RECOGNITION_DATA_PART_NAME,
      AttachmentRecognitionRenderer,
    );
    const legacyRenderer = context.renderers.data.register(
      LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME,
      AttachmentRecognitionRenderer,
    );
    const presentationDefinition = {
      display: "timeline" as const,
      isVisible(block) {
        const state = parseAttachmentRecognitionPresentation(block.data);
        return Boolean(state && !(state.status === "skipped" && state.method === "native"));
      },
      isActive(block) {
        const state = parseAttachmentRecognitionPresentation(block.data);
        return state?.status === "pending" || state?.status === "running";
      },
    } satisfies DataPresentationDefinition;
    const presentation = context.renderers.dataPresentations.register(
      ATTACHMENT_RECOGNITION_DATA_PART_NAME,
      presentationDefinition,
    );
    const legacyPresentation = context.renderers.dataPresentations.register(
      LEGACY_IMAGE_RECOGNITION_DATA_PART_NAME,
      presentationDefinition,
    );

    return [section, item, renderer, legacyRenderer, presentation, legacyPresentation];
  },
});
