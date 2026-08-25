import { defineExtension } from "@/platform/extensions/authoring";

import { PiVersion } from "./pi-version";

export const connectionStatusExtension = defineExtension({
  id: "workbench.connection-status",
  name: "Connection Status",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("statusbar.left", {
      id: "workbench.connection-status.pi-version",
      order: 0,
      component: PiVersion,
    });
  },
});
