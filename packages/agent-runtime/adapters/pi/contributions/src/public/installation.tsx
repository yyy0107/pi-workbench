"use client";

import { useLayoutEffect, useMemo, type ReactNode } from "react";

import type { RuntimeConnection } from "@workbench/host-contracts";
import type { OpenerRegistry, WorkbenchExtension } from "@workbench/extension-sdk";

import { agentConfigurationExtension } from "../extensions/agent-configuration";
import { connectionStatusExtension } from "../extensions/connection-status";
import { contextTraceExtension } from "../extensions/context-trace";
import { automationExtension } from "../extensions/automation";
import { externalSessionImportExtension } from "../extensions/external-session-import";
import { gitBranchExtension } from "../extensions/git-branch";
import { attachmentUnderstandingExtension } from "../extensions/image-understanding";
import { interactiveRequestsExtension } from "../extensions/interactive-requests";
import { modelSelectorExtension } from "../extensions/model-selector";
import { piExtensionsExtension } from "../extensions/pi-extensions";
import { settingModelConfigExtension } from "../extensions/setting-model-config";
import { sideChatExtension } from "../extensions/side-chat";
import { skillsExtension } from "../extensions/skills";
import { terminalExtension } from "../extensions/terminal";
import { tokenUsageExtension } from "../extensions/token-usage";
import { toolboxExtension } from "../extensions/toolbox";
import { workspaceDirectoryPickerExtension } from "../extensions/workspace-directory-picker";
import { workspaceExplorerExtension } from "../extensions/workspace-explorer";
import { workspaceFileExtension } from "../extensions/workspace-file";
import { workspaceReviewExtension } from "../extensions/workspace-review";
import { PiFileWorkspaceOpenersBridge } from "../services/pi-file-workspace-openers-bridge";
import { acquireFileViewerAssetBaseLease } from "../services/file-viewer-asset-base-lease";
import { WorkspaceFileRuntimeProvider } from "../services/workspace-file-runtime";
import { PiContributionInstallationServicesProvider } from "./installation-services";
import {
  normalizePiAssetBaseUrl,
  PiContributionAssetsProvider,
  PiContributionBrandingProvider,
  type PiContributionAssets,
  type PiContributionBranding,
} from "./assets-context";
import { PiRuntimeConnectionProvider } from "./runtime-connection-context";

/**
 * Pi groups are intentionally semantic rather than one opaque catalog: the app interleaves them
 * with Shell's generic frame, workspace, and Settings groups to preserve registry tie ordering.
 */
const piWorkspaceExtensions: readonly WorkbenchExtension[] = Object.freeze([
  workspaceExplorerExtension,
  workspaceReviewExtension,
]);
const piTerminalExtensions: readonly WorkbenchExtension[] = Object.freeze([terminalExtension]);
const piSetupExtensions: readonly WorkbenchExtension[] = Object.freeze([
  workspaceDirectoryPickerExtension,
  gitBranchExtension,
]);
const piRuntimeExtensions: readonly WorkbenchExtension[] = Object.freeze([
  agentConfigurationExtension,
  interactiveRequestsExtension,
  sideChatExtension,
  settingModelConfigExtension,
  attachmentUnderstandingExtension,
  skillsExtension,
  piExtensionsExtension,
  toolboxExtension,
  automationExtension,
  modelSelectorExtension,
  connectionStatusExtension,
  contextTraceExtension,
  externalSessionImportExtension,
  tokenUsageExtension,
  workspaceFileExtension,
]);

export const piAgentRuntimeExtensionGroups: Readonly<{
  workspace: readonly WorkbenchExtension[];
  terminal: readonly WorkbenchExtension[];
  setup: readonly WorkbenchExtension[];
  runtime: readonly WorkbenchExtension[];
}> = Object.freeze({
  workspace: piWorkspaceExtensions,
  terminal: piTerminalExtensions,
  setup: piSetupExtensions,
  runtime: piRuntimeExtensions,
});

/** All Pi UI contributions for consumers that do not need cross-owner ordering. */
export const piAgentRuntimeExtensions: readonly WorkbenchExtension[] = Object.freeze([
  ...piAgentRuntimeExtensionGroups.workspace,
  ...piAgentRuntimeExtensionGroups.terminal,
  ...piAgentRuntimeExtensionGroups.setup,
  ...piAgentRuntimeExtensionGroups.runtime,
]);

/**
 * Connects Pi-only contribution services to public host contracts.
 *
 * The web app owns its concrete extension-host registry and runtime connection; this package
 * receives both as narrow public ports so it remains reusable by another renderer shell.
 */
export function PiAgentRuntimeContributionsProvider({
  assets,
  branding,
  children,
  openers,
  runtimeConnection,
}: Readonly<{
  assets: PiContributionAssets;
  branding: PiContributionBranding;
  children: ReactNode;
  openers: OpenerRegistry;
  runtimeConnection: RuntimeConnection;
}>) {
  const normalizedAssets = useMemo(
    () => ({
      ...assets,
      fileViewerAssetBaseUrl: normalizePiAssetBaseUrl(assets.fileViewerAssetBaseUrl),
    }),
    [assets.fileViewerAssetBaseUrl],
  );

  // Individual viewers pass their injected base explicitly. This only leases File Viewer's
  // third-party fallback for presets that do not expose an option; concurrent roots must use the
  // same base because that fallback is process-global, and cleanup restores the original value.
  useLayoutEffect(() => {
    return acquireFileViewerAssetBaseLease(normalizedAssets.fileViewerAssetBaseUrl);
  }, [normalizedAssets.fileViewerAssetBaseUrl]);

  return (
    <PiContributionAssetsProvider assets={normalizedAssets}>
      <PiContributionBrandingProvider branding={branding}>
        <PiRuntimeConnectionProvider connection={runtimeConnection}>
          <PiContributionInstallationServicesProvider>
            <WorkspaceFileRuntimeProvider>
              <PiFileWorkspaceOpenersBridge openers={openers} />
              {children}
            </WorkspaceFileRuntimeProvider>
          </PiContributionInstallationServicesProvider>
        </PiRuntimeConnectionProvider>
      </PiContributionBrandingProvider>
    </PiContributionAssetsProvider>
  );
}

export type { PiContributionAssets, PiContributionBranding } from "./assets-context";
export { piTranslationBundle } from "../i18n";
export { PiSettingsConfigurationMenu } from "../extensions/settings/settings-header-action";
export {
  createPiRunningIndicatorRenderer,
  isPiRunningIndicatorWordmarkStyle,
  piRunningIndicatorDefinitions,
  piRunningIndicatorLabels,
  PI_RUNNING_INDICATOR_STYLE_IDS,
  PI_RUNNING_INDICATOR_WORDMARK_ASPECT_RATIO,
  type PiRunningIndicatorStyleId,
} from "../running-indicator/pi-running-indicator";
