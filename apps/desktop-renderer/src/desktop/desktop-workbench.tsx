"use client";

import type { ReactNode } from "react";

import {
  PiWorkbenchApplicationProviders,
  PiWorkbenchShell,
} from "@workbench/pi-product/application";
import { MainViewHost as ExtensionMainViewHost } from "@workbench/extension-host/hosts/main-view-host";
import { defineExtension } from "@workbench/extension-sdk";
import type { RuntimeConnection } from "@workbench/host-contracts";
import { SystemFontsProvider } from "@workbench/shell/appearance";
import { WorkbenchThread } from "@workbench/shell/chat";
import { createTranslationBundleMessageFactory, type Locale } from "@workbench/shell/i18n";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";
import { desktopRendererTranslationBundle } from "@/app/i18n/bundle";
import { DesktopNavigationProvider } from "@/navigation/desktop-navigation-provider";

import { DesktopTitleBarOverlaySync } from "./desktop-title-bar-overlay-sync";
import { DesktopTaskNotifications } from "./desktop-task-notifications";
import { desktopSettingsExtension } from "./desktop-settings";
import { getDesktopFontFamilies, restartDesktopRuntime } from "./runtime-bootstrap";

const defineDesktopRendererMessage = createTranslationBundleMessageFactory(
  desktopRendererTranslationBundle,
);
const DESKTOP_TRANSLATION_BUNDLES = Object.freeze([desktopRendererTranslationBundle]);
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
const DESKTOP_EXTENSIONS = Object.freeze([
  DESKTOP_RUNTIME_LIFECYCLE_EXTENSION,
  desktopSettingsExtension,
]);
function DesktopInstallationEffects(props: Parameters<typeof DesktopTitleBarOverlaySync>[0]) {
  return (
    <>
      <DesktopTitleBarOverlaySync {...props} />
      <DesktopTaskNotifications />
    </>
  );
}
const PRODUCT_ASSETS = Object.freeze({
  fileViewerAssetBaseUrl: "/file-viewer",
  materialIconThemeBaseUrl: "/vendor/material-icon-theme",
});
function DesktopMainViewHost({ children }: Readonly<{ children: ReactNode }>) {
  const { currentConversationId } = useWorkbenchNavigation();
  return (
    <ExtensionMainViewHost navigationKey={currentConversationId ?? "workbench-home"}>
      {children}
    </ExtensionMainViewHost>
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
    <PiWorkbenchApplicationProviders
      bundles={DESKTOP_TRANSLATION_BUNDLES}
      initialLocale={initialLocale}
      installationId="desktop-renderer-primary"
      runtimeConnection={runtimeConnection}
    >
      <SystemFontsProvider value={getDesktopFontFamilies}>
        <DesktopNavigationProvider>
          <PiWorkbenchShell
            assets={PRODUCT_ASSETS}
            platformExtensions={DESKTOP_EXTENSIONS}
            installationEffects={DesktopInstallationEffects}
            mainViewHost={DesktopMainViewHost}
          >
            <WorkbenchThread />
          </PiWorkbenchShell>
        </DesktopNavigationProvider>
      </SystemFontsProvider>
    </PiWorkbenchApplicationProviders>
  );
}
