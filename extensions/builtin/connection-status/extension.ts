import { defineExtension } from "@/platform/extensions";

import { ConnectionStatus } from "./connection-status";

export const connectionStatusExtension = defineExtension({
  id: "workbench.connection-status",
  name: "Connection Status",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("statusbar.left", {
      id: "workbench.connection-status.statusbar",
      order: 10,
      component: ConnectionStatus,
    });
  },
});
