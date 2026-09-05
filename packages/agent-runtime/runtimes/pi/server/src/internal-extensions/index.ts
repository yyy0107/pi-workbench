import { BUILTIN_EXTENSION_PREFERENCE_KEYS } from "@workbench/agent-runtime-contracts/settings";
import { isBuiltinResourceEnabled } from "../agent-runtime/pi-agent-host-bindings";
import type { InlineExtension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

import { createBuiltinToolExtensions, type BuiltinToolSettings } from "./builtin-tools";
import { createAskUserExtension, type AskUserCapabilitySettings } from "./ask-user";
import type { ToolCapabilitySettings } from "./_shared/tool-availability";
import { composerContextExtension } from "./composer-context";
import { TODO_EXTENSION_NAME, createTodoExtension } from "./rpiv-todo";
import { contextTraceExtension } from "./context-trace";
import { messageTerminationExtension } from "./message-termination";
import { instrumentSystemPromptHookTracing } from "./context-trace/system-prompt-hook-trace";

export const WORKBENCH_INTERNAL_PI_EXTENSION_PATH_PREFIX = "<inline:workbench.";

export function createWorkbenchInternalPiExtensions(
  askUserSettings?: AskUserCapabilitySettings,
  todoSettings?: ToolCapabilitySettings,
  builtinToolSettings?: BuiltinToolSettings,
) {
  return [
    ...createBuiltinToolExtensions(builtinToolSettings),
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
  const builtinTodo = result.extensions.find(
    (extension) =>
      extension.path === `<inline:${TODO_EXTENSION_NAME}>` && extension.tools.has("todo"),
  );
  if (builtinTodo) {
    // Pi loads user packages before inline extensions; the built-in todo owns this tool name.
    const todoOwners = new Set(
      result.extensions
        .filter((extension) => extension.tools.has("todo"))
        .map((extension) => extension.path),
    );
    result.extensions = result.extensions.map((extension) => {
      if (extension === builtinTodo || !extension.tools.has("todo")) return extension;
      const tools = new Map(extension.tools);
      tools.delete("todo");
      return { ...extension, tools };
    });
    result.errors = result.errors.filter(
      (error) =>
        !(todoOwners.has(error.path) && error.error.startsWith('Tool "todo" conflicts with ')),
    );
  }
  // Keep the catalog intact; read persisted state at dispatch so live sessions switch immediately.
  for (const [name, key] of Object.entries(BUILTIN_EXTENSION_PREFERENCE_KEYS)) {
    const extension = result.extensions.find((entry) => entry.path === `<inline:${name}>`);
    if (!extension) continue;
    for (const [event, handlers] of extension.handlers) {
      extension.handlers.set(
        event,
        handlers.map((handler) => async (...args: Parameters<typeof handler>) => {
          if (!(await isBuiltinResourceEnabled(key))) return;
          return handler(...args);
        }),
      );
    }
  }
  reportWorkbenchInternalPiExtensionErrors(result);
  return instrumentSystemPromptHookTracing(result);
}
