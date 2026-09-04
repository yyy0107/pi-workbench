"use client";

import { piAgentRuntimeExtensionGroups } from "@workbench/agent-runtime-pi-contributions/installation";
import { shellExtensionGroups } from "@workbench/shell/extensions";

/**
 * Product-owned, order-sensitive extension installation.
 *
 * Shell and Pi expose semantic groups so this single composition point can preserve the legacy
 * registration tie order without either reusable package knowing about the other.
 */
export const installedWorkbenchExtensions = Object.freeze([
  ...shellExtensionGroups.core,
  ...shellExtensionGroups.workspace,
  ...piAgentRuntimeExtensionGroups.setup,
  ...shellExtensionGroups.settings,
  ...piAgentRuntimeExtensionGroups.runtime,
]);
