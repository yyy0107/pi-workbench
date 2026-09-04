"use client";

import type { ReactNode } from "react";

import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { agentConfigurationExtension } from "../extensions/agent-configuration";
import { connectionStatusExtension } from "../extensions/connection-status";
import { contextTraceExtension } from "../extensions/context-trace";
import { externalSessionImportExtension } from "../extensions/external-session-import";
import { settingModelConfigExtension } from "../extensions/setting-model-config";
import { piSettingsActionExtension } from "../extensions/settings";
import { toolboxExtension } from "../extensions/toolbox";
import { PiWorkspaceFileRuntimeProvider } from "../services/workspace-file-runtime";

/**
 * Pi groups are intentionally semantic rather than one opaque catalog: the app interleaves them
 * with Shell's generic frame, workspace, and Settings groups to preserve registry tie ordering.
 */
export const piAgentRuntimeExtensionGroups = Object.freeze({
  agentConfiguration: Object.freeze([agentConfigurationExtension]),
  configuration: Object.freeze([settingModelConfigExtension, piSettingsActionExtension]),
  toolbox: Object.freeze([toolboxExtension]),
  diagnostics: Object.freeze([
    connectionStatusExtension,
    contextTraceExtension,
    externalSessionImportExtension,
  ]),
});

/** All Pi UI contributions for consumers that do not need cross-owner ordering. */
export const piAgentRuntimeExtensions: readonly WorkbenchExtension[] = Object.freeze([
  ...piAgentRuntimeExtensionGroups.agentConfiguration,
  ...piAgentRuntimeExtensionGroups.configuration,
  ...piAgentRuntimeExtensionGroups.toolbox,
  ...piAgentRuntimeExtensionGroups.diagnostics,
]);

/**
 * Connects Pi's file backend to the Workbench-owned file runtime contract.
 */
export function PiAgentRuntimeContributionsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <PiWorkspaceFileRuntimeProvider>{children}</PiWorkspaceFileRuntimeProvider>;
}

export { piTranslationBundle } from "../i18n";
export {
  createPiRunningIndicatorRenderer,
  isPiRunningIndicatorWordmarkStyle,
  piRunningIndicatorDefinitions,
  piRunningIndicatorLabels,
  PI_RUNNING_INDICATOR_STYLE_IDS,
  PI_RUNNING_INDICATOR_WORDMARK_ASPECT_RATIO,
  type PiRunningIndicatorStyleId,
} from "../running-indicator/pi-running-indicator";
