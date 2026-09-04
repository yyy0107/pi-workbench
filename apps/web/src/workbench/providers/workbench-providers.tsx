"use client";

import type { ReactNode } from "react";

import { piRunningIndicatorDefinitions } from "@workbench/agent-runtime-pi-contributions/installation";
import { WorkbenchApplicationShell } from "@workbench/shell/application";
import {
  createRunningIndicatorCatalog,
  DEFAULT_RUNNING_INDICATOR_STYLE_ID,
  shellRunningIndicatorDefinitions,
} from "@workbench/shell/running-indicator";

import { installedWorkbenchExtensions } from "@/workbench/runtime-contributions/installed-workbench-extensions";
import { MainViewHost } from "@/workbench/shell/main-view-host";

import { WorkbenchAgentRuntimeProvider } from "./agent-runtime-provider";
import {
  createWorkbenchDraftPersistence,
  createWorkbenchThreadScrollPersistence,
} from "./workbench-session-persistence";

const WEB_APPLICATION_ID = "pi-workbench";
const PRODUCT_BRANDING = Object.freeze({
  productName: "Pi Workbench",
  runtimeName: "Pi",
  productLogoUrl: "/pi-logo-on-light.svg",
});
const PRODUCT_ASSETS = Object.freeze({
  fileViewerAssetBaseUrl: "/file-viewer",
  materialIconThemeBaseUrl: "/vendor/material-icon-theme",
});
const PRODUCT_RUNNING_INDICATORS = createRunningIndicatorCatalog({
  defaultStyleId: DEFAULT_RUNNING_INDICATOR_STYLE_ID,
  definitions: Object.freeze([
    ...shellRunningIndicatorDefinitions,
    ...piRunningIndicatorDefinitions,
  ]),
});

export function WorkbenchProviders({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WorkbenchApplicationShell
      applicationId={WEB_APPLICATION_ID}
      assets={PRODUCT_ASSETS}
      branding={PRODUCT_BRANDING}
      createDraftPersistence={createWorkbenchDraftPersistence}
      createThreadScrollPersistence={createWorkbenchThreadScrollPersistence}
      extensions={installedWorkbenchExtensions}
      mainViewHost={MainViewHost}
      runningIndicatorCatalog={PRODUCT_RUNNING_INDICATORS}
      runtimeProvider={WorkbenchAgentRuntimeProvider}
    >
      {children}
    </WorkbenchApplicationShell>
  );
}
