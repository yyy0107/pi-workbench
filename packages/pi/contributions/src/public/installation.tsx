"use client";

import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { aboutExtension } from "@workbench/pi-status-ui";
import { agentConfigurationExtension } from "@workbench/pi-settings-ui";
import { connectionStatusExtension } from "@workbench/pi-status-ui";
import { contextTraceExtension } from "@workbench/pi-diagnostics-ui";
import { settingModelConfigExtension } from "@workbench/pi-settings-ui";
import { piSettingsActionExtension } from "@workbench/pi-settings-ui";
import { toolboxExtension } from "@workbench/pi-toolbox-ui";
import { usageStatisticsExtension } from "@workbench/pi-diagnostics-ui";
import { skillReadingExtension } from "@workbench/pi-toolbox-ui";

/**
 * Pi groups are intentionally semantic rather than one opaque catalog: the app interleaves them
 * with Shell's generic frame, workspace, and Settings groups to preserve registry tie ordering.
 */
export const piAgentRuntimeExtensionGroups = Object.freeze({
  agentConfiguration: Object.freeze([agentConfigurationExtension]),
  configuration: Object.freeze([
    settingModelConfigExtension,
    piSettingsActionExtension,
    usageStatisticsExtension,
  ]),
  toolbox: Object.freeze([toolboxExtension]),
  diagnostics: Object.freeze([
    connectionStatusExtension,
    contextTraceExtension,
    skillReadingExtension,
    aboutExtension,
  ]),
});

/** All Pi UI contributions for consumers that do not need cross-owner ordering. */
export const piAgentRuntimeExtensions: readonly WorkbenchExtension[] = Object.freeze([
  ...piAgentRuntimeExtensionGroups.agentConfiguration,
  ...piAgentRuntimeExtensionGroups.configuration,
  ...piAgentRuntimeExtensionGroups.toolbox,
  ...piAgentRuntimeExtensionGroups.diagnostics,
]);

export { PiAgentRuntimeContributionsProvider } from "@workbench/pi-toolbox-ui/files";

export { piTranslationBundle, piTranslationBundles } from "../i18n";
export {
  createPiRunningIndicatorRenderer,
  isPiRunningIndicatorWordmarkStyle,
  piRunningIndicatorDefinitions,
  piRunningIndicatorLabels,
  PI_RUNNING_INDICATOR_STYLE_IDS,
  PI_RUNNING_INDICATOR_WORDMARK_ASPECT_RATIO,
  type PiRunningIndicatorStyleId,
} from "@workbench/pi-status-ui/running-indicator";
