import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { WorkbenchToolDependencies } from "@workbench/pi-workbench-runtime/tools/dependencies";
import {
  createBuiltinToolExtensions,
  type BuiltinToolSettings,
} from "@workbench/pi-workbench-runtime/extensions/builtin-tools";
import { workspaceReviewExtension } from "@workbench/pi-workbench-runtime/extensions/workspace-review";
import {
  createAskUserExtension,
  type AskUserCapabilitySettings,
} from "@workbench/pi-workbench-runtime/extensions/ask-user";
import type { ToolCapabilitySettings } from "@workbench/pi-sdk-ports/tools";
import { composerContextExtension } from "@workbench/pi-workbench-runtime/extensions/composer-context";
import {
  TODO_EXTENSION_NAME,
  createTodoExtension,
} from "@workbench/pi-workbench-runtime/extensions/rpiv-todo";
import { createContextTraceExtension } from "@workbench/pi-workbench-runtime/extensions/context-trace";
import { messageTerminationExtension } from "@workbench/pi-workbench-runtime/extensions/message-termination";
import { createWorkbenchSettingsExtension } from "@workbench/pi-workbench-runtime/extensions/workbench-settings";

export function createWorkbenchInternalPiExtensions(
  dependencies: WorkbenchToolDependencies,
  askUserSettings?: AskUserCapabilitySettings,
  todoSettings?: ToolCapabilitySettings,
  builtinToolSettings?: BuiltinToolSettings,
  workbenchSettingsToolSettings?: ToolCapabilitySettings,
) {
  return [
    ...createBuiltinToolExtensions(builtinToolSettings),
    { name: "workbench.workspace-review", factory: workspaceReviewExtension, hidden: true },
    {
      name: "workbench.settings",
      factory: createWorkbenchSettingsExtension(dependencies, workbenchSettingsToolSettings),
      hidden: true,
    },
    { name: TODO_EXTENSION_NAME, factory: createTodoExtension(todoSettings), hidden: true },
    {
      name: "workbench.message-termination",
      factory: messageTerminationExtension,
      hidden: true,
    },
    {
      name: "workbench.ask-user",
      factory: createAskUserExtension(askUserSettings),
      hidden: true,
    },
    {
      name: "workbench.composer-context",
      factory: composerContextExtension,
      hidden: true,
    },
    {
      // Keep the observer last so its snapshots include transformations from every earlier extension.
      name: "workbench.context-trace",
      factory: createContextTraceExtension(dependencies.getSessionContextTrace),
      hidden: true,
    },
  ] satisfies InlineExtension[];
}
