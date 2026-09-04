"use client";

import type { ReactNode } from "react";

import {
  PiWorkbenchApplicationProviders,
  useWorkbenchApplicationInstallationId,
} from "@workbench/pi-product/application";
import type { Locale } from "@workbench/shell/i18n";
import type { RuntimeConnection } from "@workbench/host-contracts";
import { webAppTranslationBundle } from "@/app/i18n/bundle";

const INSTALLED_TRANSLATION_BUNDLES = Object.freeze([webAppTranslationBundle]);

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
  return (
    <PiWorkbenchApplicationProviders
      bundles={INSTALLED_TRANSLATION_BUNDLES}
      initialLocale={initialLocale}
      installationId={installationId}
      runtimeConnection={runtimeConnection}
    >
      {children}
    </PiWorkbenchApplicationProviders>
  );
}
