import { defineExtension } from "@workbench/extension-sdk";
import { ListChecksIcon } from "lucide-react";

import { todoAdapters } from "../../../chat/todo-model";
import { defineMessage } from "../../../i18n";
import { TodoPanel, TodoToolRenderer } from "./todo-panel";

export const todoPanelExtension = defineExtension({
  id: "workbench.todo-panel",
  name: "Todo Panel",
  version: "1.0.0",
  setup(context) {
    return [
      context.slots.register("composer.before", {
        id: "workbench.todo-panel.composer-before",
        order: 0,
        component: TodoPanel,
      }),
      ...Object.keys(todoAdapters).flatMap((toolName) => [
        context.renderers.tools.register(toolName, TodoToolRenderer),
        context.renderers.toolPresentations.register(toolName, {
          label: defineMessage("extensions.todoPanel.title"),
          activeLabel: defineMessage("extensions.todoPanel.updating"),
          icon: ListChecksIcon,
        }),
      ]),
    ];
  },
});
