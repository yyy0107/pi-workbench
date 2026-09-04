"use client";

import type { ReactNode } from "react";

import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { agentConfigurationExtension } from "../extensions/agent-configuration";
import { connectionStatusExtension } from "../extensions/connection-status";
import { contextTraceExtension } from "../extensions/context-trace";
import { automationExtension } from "../extensions/automation";
import { externalSessionImportExtension } from "../extensions/external-session-import";
import { attachmentUnderstandingExtension } from "../extensions/image-understanding";
import { interactiveRequestsExtension } from "../extensions/interactive-requests";
import { modelSelectorExtension } from "../extensions/model-selector";
import { settingModelConfigExtension } from "../extensions/setting-model-config";
import { piSettingsActionExtension } from "../extensions/settings";
import { sideChatExtension } from "../extensions/side-chat";
import { tokenUsageExtension } from "../extensions/token-usage";
import { toolboxExtension } from "../extensions/toolbox";
import { PiWorkspaceFileRuntimeProvider } from "../services/workspace-file-runtime";

/**
 * Pi groups are intentionally semantic rather than one opaque catalog: the app interleaves them
 * with Shell's generic frame, workspace, and Settings groups to preserve registry tie ordering.
 */
const piRuntimeExtensions: readonly WorkbenchExtension[] = Object.freeze([
  agentConfigurationExtension,
  interactiveRequestsExtension,
  sideChatExtension,
  settingModelConfigExtension,
  piSettingsActionExtension,
  attachmentUnderstandingExtension,
  toolboxExtension,
  automationExtension,
  modelSelectorExtension,
  connectionStatusExtension,
  contextTraceExtension,
  externalSessionImportExtension,
  tokenUsageExtension,
]);

export const piAgentRuntimeExtensionGroups: Readonly<{
  runtime: readonly WorkbenchExtension[];
}> = Object.freeze({
  runtime: piRuntimeExtensions,
});

/** All Pi UI contributions for consumers that do not need cross-owner ordering. */
export const piAgentRuntimeExtensions: readonly WorkbenchExtension[] = Object.freeze([
  ...piAgentRuntimeExtensionGroups.runtime,
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
