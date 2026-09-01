import { defineExtension } from "@workbench/extension-sdk";

import { MessageActions } from "./message-actions";

export const messageActionsExtension = defineExtension({
  id: "workbench.message-actions",
  name: "Message Actions",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("message.actions", {
      id: "workbench.message-actions.actions",
      order: 10,
      component: MessageActions,
    });
  },
});
