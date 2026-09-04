import { useWorkbenchInteractionCapability } from "@workbench/agent-runtime-client/context";
import { registerRuntimeEntries } from "../../runtime-entries";
import { MessageCircleQuestionIcon } from "lucide-react";

import { defineExtension } from "@workbench/extension-sdk";
import { defineMessage } from "@workbench/shell/i18n";

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
    const entries = registerRuntimeEntries(
      context,
      "workbench.interactive-requests.entries",
      () => Boolean(useWorkbenchInteractionCapability()),
      () => {
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
          title: defineMessage("extensions.interactiveRequests.settings.enable"),
          description: defineMessage("extensions.interactiveRequests.settings.enableDescription"),
          component: AskUserSettingsItem,
        });
        return [section, settings];
      },
    );
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
      label: defineMessage("extensions.interactiveRequests.askUserTool.activityComplete"),
      activeLabel: defineMessage("extensions.interactiveRequests.askUserTool.activityRunning"),
      getActiveLabel: (block) =>
        areAskUserQuestionsReady(block.arguments, block.result, block.argumentsText)
          ? defineMessage("extensions.interactiveRequests.askUserTool.activityRunning")
          : defineMessage("extensions.interactiveRequests.askUserTool.activityGenerating"),
      icon: MessageCircleQuestionIcon,
      summarize: (block) => {
        const count = askUserQuestionCount(block.arguments, block.result);
        return areAskUserQuestionsReady(block.arguments, block.result, block.argumentsText) &&
          count > 0
          ? defineMessage("extensions.interactiveRequests.askUserTool.questionCount", { count })
          : "…";
      },
    });

    return [entries, question, approval, toolRenderer, toolPresentation];
  },
});
