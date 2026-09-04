import { defineExtension } from "@workbench/extension-sdk";

import { PiSettingsHeaderAction } from "./settings-header-action";

/** Pi owns its Settings action and contributes it without application-level component injection. */
export const piSettingsActionExtension = defineExtension({
  id: "workbench.pi.settings-action",
  name: "Pi Settings Action",
  version: "1.0.0",

  setup(context) {
    return context.slots.register("header.right", {
      id: "workbench.pi.settings-action.header",
      order: 81,
      component: PiSettingsHeaderAction,
    });
  },
});
