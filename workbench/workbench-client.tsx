"use client";

import type { ReactNode } from "react";

import { WorkbenchProviders } from "./providers/workbench-providers";
import { WorkbenchShell } from "./shell/workbench-shell";

export function WorkbenchClient({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WorkbenchProviders>
      <WorkbenchShell>{children}</WorkbenchShell>
    </WorkbenchProviders>
  );
}
