import { defineExtension } from "@/platform/extensions/authoring";

import { UserMessageIndex } from "./user-message-index";

export const userMessageIndexExtension = defineExtension({
  id: "workbench.user-message-index",
  name: "User Message Index",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("thread.left", {
      id: "workbench.user-message-index.thread-left",
      order: 0,
      component: UserMessageIndex,
    });
  },
});
