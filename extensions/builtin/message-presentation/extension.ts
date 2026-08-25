import { defineExtension } from "@/platform/extensions/authoring";

import { WorkbenchMessagePresentation } from "./message-presentation";

export const messagePresentationExtension = defineExtension({
  id: "workbench.message-presentation",
  name: "Message Presentation",
  version: "1.0.0",

  setup(context) {
    return context.renderers.message.register({
      id: "workbench.message-presentation",
      component: WorkbenchMessagePresentation,
    });
  },
});
