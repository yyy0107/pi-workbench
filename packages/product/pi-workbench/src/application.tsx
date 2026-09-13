"use client";

import { useMemo, type ComponentProps } from "react";
import {
  piRunningIndicatorDefinitions,
  piTranslationBundles,
} from "@workbench/pi-ui-extensions/installation";
import type { WorkbenchExtension } from "@workbench/extension-sdk";
import {
  WorkbenchApplicationProviders,
  WorkbenchApplicationShell,
  type WorkbenchApplicationShellProps,
} from "@workbench/shell/application";
import { createRunningIndicatorCatalog } from "@workbench/shell-context/running-indicator";

import {
  DEFAULT_RUNNING_INDICATOR_STYLE_ID,
  shellRunningIndicatorDefinitions,
} from "./running-indicator-defaults";

import { MarkdownLinkAdapterProvider } from "@workbench/markdown/links";
import { workspaceMarkdownLinkAdapter } from "@workbench/workspace-files/markdown-links";

import { piWorkbenchExtensions } from "./extensions";
import { PiWorkbenchRuntimeProvider } from "./runtime-provider";
import { createInstalledWorkbenchSettingsService } from "./settings";

export { useWorkbenchApplicationInstallationId } from "@workbench/shell/application";
export { piWorkbenchExtensions } from "./extensions";

const PRODUCT_BRANDING = Object.freeze({
  productName: "Pi Workbench",
  runtimeName: "Pi",
  productLogoUrl: "/pi-logo-on-light.svg",
});
const PRODUCT_RUNNING_INDICATORS = createRunningIndicatorCatalog({
  defaultStyleId: DEFAULT_RUNNING_INDICATOR_STYLE_ID,
  definitions: Object.freeze([
    ...shellRunningIndicatorDefinitions,
    ...piRunningIndicatorDefinitions,
  ]),
});
const NO_PLATFORM_EXTENSIONS: readonly WorkbenchExtension[] = Object.freeze([]);

export function PiWorkbenchApplicationProviders({
  bundles,
  ...props
}: Omit<ComponentProps<typeof WorkbenchApplicationProviders>, "createSettingsService">) {
  const installedBundles = useMemo(() => [...bundles, ...piTranslationBundles], [bundles]);
  return (
    <MarkdownLinkAdapterProvider adapter={workspaceMarkdownLinkAdapter}>
      <WorkbenchApplicationProviders
        {...props}
        bundles={installedBundles}
        createSettingsService={createInstalledWorkbenchSettingsService}
      />
    </MarkdownLinkAdapterProvider>
  );
}

export function PiWorkbenchShell({
  platformExtensions = NO_PLATFORM_EXTENSIONS,
  branding = PRODUCT_BRANDING,
  ...props
}: Omit<
  WorkbenchApplicationShellProps,
  "applicationId" | "runtimeProvider" | "extensions" | "runningIndicatorCatalog" | "branding"
> & {
  readonly platformExtensions?: readonly WorkbenchExtension[];
  readonly branding?: WorkbenchApplicationShellProps["branding"];
}) {
  const extensions = useMemo(
    () =>
      platformExtensions.length
        ? Object.freeze([...piWorkbenchExtensions, ...platformExtensions])
        : piWorkbenchExtensions,
    [platformExtensions],
  );
  return (
    <WorkbenchApplicationShell
      {...props}
      applicationId="pi-workbench"
      branding={branding}
      extensions={extensions}
      runningIndicatorCatalog={PRODUCT_RUNNING_INDICATORS}
      runtimeProvider={PiWorkbenchRuntimeProvider}
    />
  );
}
