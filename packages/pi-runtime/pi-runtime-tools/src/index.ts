import { isWorkbenchInternalPiExtensionPath } from "@workbench/pi-sdk-resources/internal-extensions";
export {
  isWorkbenchInternalPiExtensionPath,
  WORKBENCH_INTERNAL_PI_EXTENSION_PATH_PREFIX,
} from "@workbench/pi-sdk-resources/internal-extensions";
import { BUILTIN_EXTENSION_PREFERENCE_KEYS } from "@workbench/agent-runtime-contracts/settings";
import type { WorkbenchToolDependencies } from "./dependencies";
import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

import { TODO_EXTENSION_NAME } from "./rpiv-todo";
import { instrumentSystemPromptHookTracing } from "../lib/system-prompt-hook-trace";

export function reportWorkbenchInternalPiExtensionErrors(
  result: LoadExtensionsResult,
): LoadExtensionsResult {
  for (const error of result.errors) {
    if (!isWorkbenchInternalPiExtensionPath(error.path)) continue;
    console.error(`[workbench-pi] internal extension ${error.path} failed to load.`, error.error);
  }
  return result;
}

export function prepareWorkbenchPiExtensions(
  result: LoadExtensionsResult,
  dependencies: WorkbenchToolDependencies,
): LoadExtensionsResult {
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
          if (!(await dependencies.isBuiltinResourceEnabled(key))) return;
          return handler(...args);
        }),
      );
    }
  }
  reportWorkbenchInternalPiExtensionErrors(result);
  return instrumentSystemPromptHookTracing(result, dependencies);
}
