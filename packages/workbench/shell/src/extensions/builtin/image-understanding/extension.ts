import {
  useWorkbenchAttachmentUnderstandingCapability,
  useWorkbenchModelSelectionCapability,
} from "@workbench/agent-runtime-client/context";
import { registerRuntimeEntries } from "../../runtime-entries";
import { ScanTextIcon } from "lucide-react";

import { defineExtension, type DataPresentationDefinition } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

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
    const entries = registerRuntimeEntries(
      context,
      "workbench.image-understanding.entries",
      () => {
        const attachments = useWorkbenchAttachmentUnderstandingCapability();
        const models = useWorkbenchModelSelectionCapability();
        return Boolean(attachments && models);
      },
      () => {
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
          title: defineMessage("extensions.imageUnderstanding.title"),
          description: defineMessage("extensions.imageUnderstanding.description"),
          keywords: [
            defineMessage("extensions.imageUnderstanding.settings.routing.label"),
            defineMessage("extensions.imageUnderstanding.settings.engine.label"),
            defineMessage("extensions.imageUnderstanding.settings.ocrProvider.label"),
            defineMessage("extensions.imageUnderstanding.settings.ocrAdapter.label"),
          ],
          component: AttachmentUnderstandingSettingsItem,
        });
        return [section, item];
      },
    );
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

    return [entries, renderer, legacyRenderer, presentation, legacyPresentation];
  },
});
