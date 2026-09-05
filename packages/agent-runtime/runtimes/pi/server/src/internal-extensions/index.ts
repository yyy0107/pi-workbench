import type { InlineExtension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

import { createAskUserExtension, type AskUserCapabilitySettings } from "./ask-user";
import { composerContextExtension } from "./composer-context";
import { todoExtension } from "./todo";
import { contextTraceExtension } from "./context-trace";
import { messageTerminationExtension } from "./message-termination";
import { instrumentSystemPromptHookTracing } from "./system-prompt-hook-trace";

export const WORKBENCH_INTERNAL_PI_EXTENSION_PATH_PREFIX = "<inline:workbench.";

export function createWorkbenchInternalPiExtensions(askUserSettings?: AskUserCapabilitySettings) {
  return [
    { name: "workbench.todo", factory: todoExtension, hidden: true },
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
      factory: contextTraceExtension,
      hidden: true,
    },
  ] satisfies InlineExtension[];
}

export const workbenchInternalPiExtensions = createWorkbenchInternalPiExtensions();

export function isWorkbenchInternalPiExtensionPath(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(WORKBENCH_INTERNAL_PI_EXTENSION_PATH_PREFIX);
}

export function reportWorkbenchInternalPiExtensionErrors(
  result: LoadExtensionsResult,
): LoadExtensionsResult {
  for (const error of result.errors) {
    if (!isWorkbenchInternalPiExtensionPath(error.path)) continue;
    console.error(`[workbench-pi] internal extension ${error.path} failed to load.`, error.error);
  }
  return result;
}

export function prepareWorkbenchPiExtensions(result: LoadExtensionsResult): LoadExtensionsResult {
  reportWorkbenchInternalPiExtensionErrors(result);
  return instrumentSystemPromptHookTracing(result);
}
