"use client";

import type { ReactNode } from "react";

import { PiWorkbenchShell } from "@workbench/pi-product/application";
import { MainViewHost } from "@/workbench/shell/main-view-host";

import {
  createWorkbenchDraftPersistence,
  createWorkbenchThreadScrollPersistence,
} from "./workbench-session-persistence";

const PRODUCT_ASSETS = Object.freeze({
  fileViewerAssetBaseUrl: "/file-viewer",
  materialIconThemeBaseUrl: "/vendor/material-icon-theme",
});
export function WorkbenchProviders({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <PiWorkbenchShell
      assets={PRODUCT_ASSETS}
      createDraftPersistence={createWorkbenchDraftPersistence}
      createThreadScrollPersistence={createWorkbenchThreadScrollPersistence}
      mainViewHost={MainViewHost}
    >
      {children}
    </PiWorkbenchShell>
  );
}
