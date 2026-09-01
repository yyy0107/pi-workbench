"use client";

import type { ReactNode } from "react";

import type { OpenerRegistry, WorkspaceSurfaceRegistry } from "@workbench/extension-sdk";
import { WorkbenchApplicationRightWorkspaceProvider } from "@workbench/shell/application";
import type { RightWorkspaceDraftPersistencePort } from "@workbench/shell/right-workspace";

const WEB_APPLICATION_ID = "pi-workbench";

/** Web identity adapter for the reusable application Right Workspace installation. */
export function RightWorkspaceProvider({
  children,
  draftPersistence,
  openers,
  registry,
}: Readonly<{
  children: ReactNode;
  draftPersistence: RightWorkspaceDraftPersistencePort;
  openers: OpenerRegistry;
  registry: WorkspaceSurfaceRegistry;
}>) {
  return (
    <WorkbenchApplicationRightWorkspaceProvider
      applicationId={WEB_APPLICATION_ID}
      draftPersistence={draftPersistence}
      openers={openers}
      registry={registry}
    >
      {children}
    </WorkbenchApplicationRightWorkspaceProvider>
  );
}
