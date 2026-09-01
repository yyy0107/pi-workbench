"use client";

import {
  PiSettingsConfigurationMenu,
  piAgentRuntimeExtensionGroups,
} from "@workbench/agent-runtime-pi-contributions/installation";
import { createWorkbenchExtensionPrefix } from "@workbench/shell/application";

/**
 * Product-owned, order-sensitive extension prefix.
 *
 * Shell and Pi expose semantic groups so this single composition point can preserve the legacy
 * registration tie order without either reusable package knowing about the other.
 */
export const installedWorkbenchExtensionPrefix = Object.freeze([
  ...createWorkbenchExtensionPrefix({
    runtimeExtensionGroups: piAgentRuntimeExtensionGroups,
    SettingsViewHeaderAction: PiSettingsConfigurationMenu,
  }),
]);
