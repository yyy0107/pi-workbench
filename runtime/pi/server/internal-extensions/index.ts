import type { InlineExtension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

import { contextTraceExtension } from "./context-trace";
import { messageTerminationExtension } from "./message-termination";

export const WORKBENCH_INTERNAL_PI_EXTENSION_PATH_PREFIX = "<inline:workbench.";

export const workbenchInternalPiExtensions = [
  {
    name: "workbench.message-termination",
    factory: messageTerminationExtension,
    hidden: true,
  },
  {
    // Keep the observer last so its snapshots include transformations from every earlier extension.
    name: "workbench.context-trace",
    factory: contextTraceExtension,
    hidden: true,
  },
] satisfies InlineExtension[];

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
