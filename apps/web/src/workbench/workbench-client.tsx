"use client";

import type { ReactNode } from "react";

import { WorkbenchProviders } from "./providers/workbench-providers";
import { InstalledWorkbenchNavigationProvider } from "./providers/workbench-navigation-provider";

export function WorkbenchClient({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <InstalledWorkbenchNavigationProvider>
      <WorkbenchProviders>{children}</WorkbenchProviders>
    </InstalledWorkbenchNavigationProvider>
  );
}
