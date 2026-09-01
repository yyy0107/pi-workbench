"use client";

import { useCallback, useMemo, type ReactNode } from "react";

import {
  createPiAgentRuntimeInstallation,
  type PiAgentRuntimeCopy,
} from "@workbench/agent-runtime-pi-client/installation";
import { createPiWorkbenchSettingsClient } from "@workbench/agent-runtime-pi-client/workbench-settings";
import {
  PiAgentRuntimeContributionsProvider,
  PiSettingsConfigurationMenu,
  piAgentRuntimeExtensionGroups,
  piRunningIndicatorDefinitions,
  piTranslationBundle,
} from "@workbench/agent-runtime-pi-contributions/installation";
import { MainViewHost as ExtensionMainViewHost } from "@workbench/extension-host/hosts/main-view-host";
import { defineExtension } from "@workbench/extension-sdk";
import { createRuntimeFetch, createRuntimeWebSocketFactory } from "@workbench/host-client";
import type { RuntimeConnection } from "@workbench/host-contracts";
import {
  WorkbenchAgentRuntimeApplicationProvider,
  WorkbenchApplicationProviders,
  WorkbenchApplicationShell,
  createWorkbenchExtensionPrefix,
  type WorkbenchAgentRuntimeInstallationOptions,
  type WorkbenchRuntimeContributionsProviderProps,
} from "@workbench/shell/application";
import { WorkbenchThread } from "@workbench/shell/chat";
import { createTranslationBundleMessageFactory, useI18n, type Locale } from "@workbench/shell/i18n";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";
import {
  createRunningIndicatorCatalog,
  DEFAULT_RUNNING_INDICATOR_STYLE_ID,
  shellRunningIndicatorDefinitions,
} from "@workbench/shell/running-indicator";
import { snapshotRuntimeConnection } from "@workbench/shell/runtime-connection";

import { desktopRendererTranslationBundle } from "@/app/i18n/bundle";
import { DesktopNavigationProvider } from "@/navigation/desktop-navigation-provider";

import { DesktopTitleBarOverlaySync } from "./desktop-title-bar-overlay-sync";
import { restartDesktopRuntime } from "./runtime-bootstrap";

const DESKTOP_APPLICATION_ID = "pi-workbench";
const defineDesktopRendererMessage = createTranslationBundleMessageFactory(
  desktopRendererTranslationBundle,
);
const DESKTOP_TRANSLATION_BUNDLES = Object.freeze([
  desktopRendererTranslationBundle,
  piTranslationBundle,
]);
const DESKTOP_RUNTIME_LIFECYCLE_EXTENSION = defineExtension({
  id: "workbench.desktop-runtime-lifecycle",
  name: "Desktop Runtime Lifecycle",
  version: "1.0.0",
  setup(context) {
    return context.commands.register({
      id: "desktop.runtime.restart",
      title: defineDesktopRendererMessage("desktopRenderer.runtime.restart.title"),
      description: defineDesktopRendererMessage("desktopRenderer.runtime.restart.description"),
      category: defineDesktopRendererMessage("desktopRenderer.runtime.category"),
      run: restartDesktopRuntime,
    });
  },
});
const DESKTOP_EXTENSION_PREFIX = Object.freeze([
  ...createWorkbenchExtensionPrefix({
    runtimeExtensionGroups: piAgentRuntimeExtensionGroups,
    SettingsViewHeaderAction: PiSettingsConfigurationMenu,
  }),
  DESKTOP_RUNTIME_LIFECYCLE_EXTENSION,
]);
const PRODUCT_BRANDING = Object.freeze({
  productName: "Pi Workbench",
  runtimeName: "Pi",
  productLogoUrl: "/pi-logo-on-light.svg",
});
const PRODUCT_ASSETS = Object.freeze({
  materialIconThemeBaseUrl: "/vendor/material-icon-theme",
});
const PRODUCT_RUNNING_INDICATORS = createRunningIndicatorCatalog({
  defaultStyleId: DEFAULT_RUNNING_INDICATOR_STYLE_ID,
  definitions: Object.freeze([
    ...shellRunningIndicatorDefinitions,
    ...piRunningIndicatorDefinitions,
  ]),
});

function createInstalledWorkbenchSettingsService(connection: RuntimeConnection) {
  const runtimeConnection = snapshotRuntimeConnection(connection);
  return createPiWorkbenchSettingsClient({
    transport: createRuntimeFetch(runtimeConnection),
  });
}

function DesktopMainViewHost({ children }: Readonly<{ children: ReactNode }>) {
  const { currentConversationId } = useWorkbenchNavigation();
  return (
    <ExtensionMainViewHost navigationKey={currentConversationId ?? "workbench-home"}>
      {children}
    </ExtensionMainViewHost>
  );
}

function InstalledRuntimeContributions({
  children,
  openers,
  runtimeConnection,
}: WorkbenchRuntimeContributionsProviderProps) {
  return (
    <PiAgentRuntimeContributionsProvider
      assets={{ fileViewerAssetBaseUrl: "/file-viewer/" }}
      branding={{ piLogoUrl: "/pi-logo-on-light.svg", runtimeName: "Pi" }}
      openers={openers}
      runtimeConnection={runtimeConnection}
    >
      {children}
    </PiAgentRuntimeContributionsProvider>
  );
}

function DesktopAssistantRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useI18n();
  const copy = useMemo<PiAgentRuntimeCopy>(
    () => ({
      titles: {
        attachment: t("workbench.chat.titles.attachmentAnalysis"),
        image: t("workbench.chat.titles.imageConversation"),
      },
      errors: {
        sessionBusy: t("workbench.chat.errors.sessionBusy"),
        emptyPrompt: t("workbench.chat.errors.emptyPrompt"),
        sessionNotFound: t("workbench.chat.errors.sessionNotFound"),
        invalidWorkingDirectory: t("workbench.chat.errors.invalidWorkingDirectory"),
        invalidWorkspace: t("workbench.chat.errors.invalidWorkspace"),
        modelNotAvailable: t("workbench.chat.errors.modelNotAvailable"),
        requestFailed: t("workbench.chat.errors.requestFailed"),
      },
    }),
    [t],
  );
  const createInstallation = useCallback(
    ({
      promptFeedback,
      runtimeConnection,
      workspaceDirectoryStore,
    }: WorkbenchAgentRuntimeInstallationOptions) => {
      const installedRuntimeConnection = snapshotRuntimeConnection(runtimeConnection);
      return createPiAgentRuntimeInstallation({
        copy,
        promptFeedback,
        transport: Object.freeze({
          http: createRuntimeFetch(installedRuntimeConnection),
          webSocketFactory: createRuntimeWebSocketFactory(installedRuntimeConnection),
        }),
        workspaceDirectoryStore,
      });
    },
    [copy],
  );

  return (
    <WorkbenchAgentRuntimeApplicationProvider
      applicationId={DESKTOP_APPLICATION_ID}
      createInstallation={createInstallation}
      runtimeContributionsProvider={InstalledRuntimeContributions}
    >
      {children}
    </WorkbenchAgentRuntimeApplicationProvider>
  );
}

/** Full static-renderer product tree. Platform containers only need to supply bootstrap. */
export function DesktopWorkbench({
  initialLocale,
  runtimeConnection,
}: Readonly<{
  initialLocale: Locale;
  runtimeConnection: RuntimeConnection;
}>) {
  return (
    <WorkbenchApplicationProviders
      bundles={DESKTOP_TRANSLATION_BUNDLES}
      createSettingsService={createInstalledWorkbenchSettingsService}
      initialLocale={initialLocale}
      installationId="desktop-renderer-primary"
      runtimeConnection={runtimeConnection}
    >
      <DesktopNavigationProvider>
        <WorkbenchApplicationShell
          applicationId={DESKTOP_APPLICATION_ID}
          assets={PRODUCT_ASSETS}
          branding={PRODUCT_BRANDING}
          extensionPrefix={DESKTOP_EXTENSION_PREFIX}
          installationEffects={DesktopTitleBarOverlaySync}
          mainViewHost={DesktopMainViewHost}
          runningIndicatorCatalog={PRODUCT_RUNNING_INDICATORS}
          runtimeProvider={DesktopAssistantRuntimeProvider}
        >
          <WorkbenchThread />
        </WorkbenchApplicationShell>
      </DesktopNavigationProvider>
    </WorkbenchApplicationProviders>
  );
}
