import { defineExtension } from "@/platform/extensions/authoring";

import { ComposerMessageQueue } from "./composer-message-queue";

export const messageQueueExtension = defineExtension({
  id: "workbench.message-queue",
  name: "Message Queue",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("composer.before", {
      id: "workbench.message-queue.composer-before",
      order: 10,
      component: ComposerMessageQueue,
    });
  },
});
