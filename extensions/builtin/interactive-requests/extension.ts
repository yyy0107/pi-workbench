import { MessageCircleQuestionIcon } from "lucide-react";

import { defineMessage } from "@/i18n";
import { defineExtension } from "@/platform/extensions/authoring";

import { AskUserSettingsItem } from "./ask-user-settings-item";
import {
  InteractiveQuestionComposerOverlay,
  InteractiveRequestsOverlay,
} from "./interactive-requests-overlay";

export const interactiveRequestsExtension = defineExtension({
  id: "workbench.interactive-requests",
  name: "Interactive Requests",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "ask-user",
      title: defineMessage("extensions.interactiveRequests.settings.title"),
      description: defineMessage("extensions.interactiveRequests.settings.description"),
      icon: MessageCircleQuestionIcon,
      group: {
        id: "capabilities",
        title: defineMessage("extensions.settings.groups.capabilities"),
      },
      order: 65,
    });
    const settings = context.settings.registerItem({
      sectionId: "ask-user",
      id: "capability",
      component: AskUserSettingsItem,
    });
    const question = context.slots.register("composer.overlay", {
      id: "workbench.interactive-requests.question",
      component: InteractiveQuestionComposerOverlay,
    });
    const approval = context.slots.register("shell.overlay", {
      id: "workbench.interactive-requests.overlay",
      order: 10,
      component: InteractiveRequestsOverlay,
    });

    return [section, settings, question, approval];
  },
});
