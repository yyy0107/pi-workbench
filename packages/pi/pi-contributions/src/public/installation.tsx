"use client";

import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { aboutExtension } from "@workbench/pi-ui-status";
import { agentConfigurationExtension } from "@workbench/pi-ui-settings";
import { connectionStatusExtension } from "@workbench/pi-ui-status";
import { contextTraceExtension } from "@workbench/pi-ui-diagnostics";
import { settingModelConfigExtension } from "@workbench/pi-ui-settings";
import { piSettingsActionExtension } from "@workbench/pi-ui-settings";
import { toolboxExtension } from "@workbench/pi-ui-toolbox";
import { usageStatisticsExtension } from "@workbench/pi-ui-diagnostics";
import { skillReadingExtension } from "@workbench/pi-ui-toolbox";

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

export { PiAgentRuntimeContributionsProvider } from "@workbench/pi-ui-toolbox/files";

export { piTranslationBundle, piTranslationBundles } from "../i18n";
export {
  createPiRunningIndicatorRenderer,
  isPiRunningIndicatorWordmarkStyle,
  piRunningIndicatorDefinitions,
  piRunningIndicatorLabels,
  PI_RUNNING_INDICATOR_STYLE_IDS,
  PI_RUNNING_INDICATOR_WORDMARK_ASPECT_RATIO,
  type PiRunningIndicatorStyleId,
} from "@workbench/pi-ui-status/running-indicator";
