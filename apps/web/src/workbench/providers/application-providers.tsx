"use client";

import { useState, type ReactNode } from "react";

import { piTranslationBundle } from "@workbench/agent-runtime-pi-contributions/installation";
import {
  WorkbenchApplicationProviders as ShellWorkbenchApplicationProviders,
  useWorkbenchApplicationInstallationId,
} from "@workbench/shell/application";
import type { Locale } from "@workbench/shell/i18n";
import type { RuntimeConnection } from "@workbench/host-contracts";
import { webAppTranslationBundle } from "@/app/i18n/bundle";

import { getWorkbenchDesktopRuntimeConnection } from "../desktop/runtime-bootstrap";
import { createInstalledWorkbenchSettingsService } from "./installed-workbench-settings";

const INSTALLED_TRANSLATION_BUNDLES = Object.freeze([webAppTranslationBundle, piTranslationBundle]);

export { useWorkbenchApplicationInstallationId };

/** Web adapter for the reusable renderer-wide application providers. */
export function WorkbenchApplicationProviders({
  children,
  initialLocale,
  installationId,
  runtimeConnection,
}: Readonly<{
  children: ReactNode;
  initialLocale: Locale;
  installationId: string;
  runtimeConnection: RuntimeConnection;
}>) {
  const [installedRuntimeConnection] = useState(
    () => getWorkbenchDesktopRuntimeConnection() ?? runtimeConnection,
  );
  return (
    <ShellWorkbenchApplicationProviders
      bundles={INSTALLED_TRANSLATION_BUNDLES}
      createSettingsService={createInstalledWorkbenchSettingsService}
      initialLocale={initialLocale}
      installationId={installationId}
      runtimeConnection={installedRuntimeConnection}
    >
      {children}
    </ShellWorkbenchApplicationProviders>
  );
}
