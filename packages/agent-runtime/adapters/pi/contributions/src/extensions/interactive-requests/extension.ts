import { MessageCircleQuestionIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

import { definePiMessage } from "../../i18n";

import { AskUserSettingsItem } from "./ask-user-settings-item";
import { areAskUserQuestionsReady, askUserQuestionCount } from "./ask-user-tool-model";
import { AskUserToolRenderer } from "./ask-user-tool-renderer";
import {
  InteractiveQuestionComposerOverlay,
  InteractiveRequestsOverlay,
} from "./interactive-requests-overlay";

const ASK_USER_TOOL_NAME = "ask_user";

export const interactiveRequestsExtension = defineExtension({
  id: "workbench.interactive-requests",
  name: "Interactive Requests",
  version: "1.0.0",

  setup(context) {
    const section = context.settings.registerSection({
      id: "ask-user",
      title: definePiMessage("extensions.interactiveRequests.settings.title"),
      description: definePiMessage("extensions.interactiveRequests.settings.description"),
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
      title: definePiMessage("extensions.interactiveRequests.settings.enable"),
      description: definePiMessage("extensions.interactiveRequests.settings.enableDescription"),
      component: AskUserSettingsItem,
    });
    const question = context.slots.register("composer.overlay", {
      id: "workbench.interactive-requests.question",
      component: InteractiveQuestionComposerOverlay,
    });
    const approval = context.slots.register("composer.overlay", {
      id: "workbench.interactive-requests.overlay",
      order: 10,
      component: InteractiveRequestsOverlay,
    });
    const toolRenderer = context.renderers.tools.register(ASK_USER_TOOL_NAME, AskUserToolRenderer);
    const toolPresentation = context.renderers.toolPresentations.register(ASK_USER_TOOL_NAME, {
      label: definePiMessage("extensions.interactiveRequests.askUserTool.activityComplete"),
      activeLabel: definePiMessage("extensions.interactiveRequests.askUserTool.activityRunning"),
      getActiveLabel: (part) =>
        areAskUserQuestionsReady(part.args, part.result ?? part.artifact, part.argsText)
          ? definePiMessage("extensions.interactiveRequests.askUserTool.activityRunning")
          : definePiMessage("extensions.interactiveRequests.askUserTool.activityGenerating"),
      icon: MessageCircleQuestionIcon,
      summarize: (part) => {
        const output = part.result ?? part.artifact;
        const count = askUserQuestionCount(part.args, output);
        return areAskUserQuestionsReady(part.args, output, part.argsText) && count > 0
          ? definePiMessage("extensions.interactiveRequests.askUserTool.questionCount", { count })
          : "…";
      },
    });

    return [section, settings, question, approval, toolRenderer, toolPresentation];
  },
});
