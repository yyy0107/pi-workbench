import { defineExtension } from "@/platform/extensions";

import { InteractiveRequestsOverlay } from "./interactive-requests-overlay";

export const interactiveRequestsExtension = defineExtension({
  id: "workbench.interactive-requests",
  name: "Interactive Requests",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("shell.overlay", {
      id: "workbench.interactive-requests.overlay",
      order: 10,
      component: InteractiveRequestsOverlay,
    });
  },
});
