"use client";

import { useMemo, type ReactNode } from "react";

import { usePiResourceClient } from "@workbench/agent-runtime-pi-client/resources";
import type { WorkbenchExtension } from "@workbench/extension-sdk";
import { WorkbenchWorkspaceFileRuntimeProvider } from "@workbench/shell/workspace-files";

import { agentConfigurationExtension } from "../extensions/agent-configuration";
import { connectionStatusExtension } from "../extensions/connection-status";
import { contextTraceExtension } from "../extensions/context-trace";
import { externalSessionImportExtension } from "../extensions/external-session-import";
import { settingModelConfigExtension } from "../extensions/setting-model-config";
import { piSettingsActionExtension } from "../extensions/settings";
import { toolboxExtension } from "../extensions/toolbox";
import { createPiResourceFileBackend } from "../services/pi-resource-file-backend";

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
 * Supplies only Pi Skill/Extension resources to Shell's capability-backed file runtime.
 */
export function PiAgentRuntimeContributionsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const client = usePiResourceClient();
  const resources = useMemo(() => createPiResourceFileBackend(client), [client]);
  return (
    <WorkbenchWorkspaceFileRuntimeProvider resources={resources}>
      {children}
    </WorkbenchWorkspaceFileRuntimeProvider>
  );
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
